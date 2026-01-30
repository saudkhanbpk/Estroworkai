const { ChatOpenAI } = require('@langchain/openai');
const { AgentExecutor, createOpenAIFunctionsAgent } = require('langchain/agents');
const { DynamicStructuredTool } = require('@langchain/core/tools');
const { ChatPromptTemplate, MessagesPlaceholder } = require('@langchain/core/prompts');
const { z } = require('zod');
const dockerUtils = require('../utils/docker');
const logger = require('../utils/logger');
const unsplashService = require('../services/unsplash');

/**
 * Agent modes
 */
const AgentMode = {
  CREATE: 'create',   // Creating a new project from scratch
  UPDATE: 'update',   // Modifying existing project files
};

/**
 * Create AI Code Agent with LangChain
 * Tools: writeFile, readFile, listFiles, runCommand, updateFile
 * @param {string} containerId - Docker container ID
 * @param {function} onUpdate - Callback for progress updates
 * @param {string} mode - Agent mode: 'create' or 'update'
 */
function createCodeAgent(containerId, onUpdate, mode = AgentMode.CREATE) {
  const llm = new ChatOpenAI({
    modelName: 'gpt-4o-mini',
    temperature: 0.2,
    openAIApiKey: process.env.OPENAI_API_KEY,
  });

  // Track executed commands and written files to prevent loops
  const executedCommands = new Set();
  const writtenFiles = new Set();
  const readFiles = new Map(); // Store file contents that have been read

  // Define tools with proper schemas for OpenAI Functions Agent
  const tools = [
    new DynamicStructuredTool({
      name: 'writeFile',
      description: 'Write content to a file in the workspace. Use this to create new files.',
      schema: z.object({
        path: z.string().describe('The full file path starting with /workspace/, e.g. /workspace/package.json'),
        content: z.string().describe('The complete file content to write'),
      }),
      func: async ({ path, content }) => {
        try {
          if (writtenFiles.has(path)) {
            logger.info(`File already written, skipping: ${path}`);
            return `File already created: ${path}. Moving on.`;
          }

          await dockerUtils.writeFile(containerId, path, content);
          writtenFiles.add(path);
          onUpdate?.({ action: 'writeFile', path, content, success: true });
          logger.info(`Agent wrote file: ${path}`);
          return `Successfully wrote file: ${path}`;
        } catch (error) {
          logger.error(`writeFile error: ${error.message}`);
          return `Error writing file: ${error.message}`;
        }
      },
    }),

    new DynamicStructuredTool({
      name: 'readFile',
      description: 'Read content from a file. Always read a file before modifying it.',
      schema: z.object({
        path: z.string().describe('The full file path to read, e.g. /workspace/src/App.jsx'),
      }),
      func: async ({ path }) => {
        try {
          const result = await dockerUtils.readFile(containerId, path);
          const content = result.output || '';
          readFiles.set(path, content);
          onUpdate?.({ action: 'readFile', path, success: true });
          return content || 'File is empty';
        } catch (error) {
          return `Error reading file: ${error.message}`;
        }
      },
    }),

    new DynamicStructuredTool({
      name: 'updateFile',
      description: 'Update an existing file. You MUST call readFile first before using this tool.',
      schema: z.object({
        path: z.string().describe('The full file path to update, e.g. /workspace/src/App.jsx'),
        content: z.string().describe('The new complete file content'),
      }),
      func: async ({ path, content }) => {
        try {
          if (!readFiles.has(path)) {
            return `ERROR: You must read "${path}" first using readFile before updating it.`;
          }

          if (writtenFiles.has(path)) {
            logger.info(`File already updated, skipping: ${path}`);
            return `File already updated: ${path}. Moving on.`;
          }

          await dockerUtils.writeFile(containerId, path, content);
          writtenFiles.add(path);
          onUpdate?.({ action: 'updateFile', path, content, success: true });
          logger.info(`Agent updated file: ${path}`);
          return `Successfully updated file: ${path}`;
        } catch (error) {
          return `Error updating file: ${error.message}`;
        }
      },
    }),

    new DynamicStructuredTool({
      name: 'listFiles',
      description: 'List all files and directories in a path.',
      schema: z.object({
        path: z.string().default('/workspace').describe('Directory path to list, defaults to /workspace'),
      }),
      func: async ({ path }) => {
        try {
          const files = await dockerUtils.listFiles(containerId, path || '/workspace');
          onUpdate?.({ action: 'listFiles', path, success: true });
          return files.length > 0 ? files.join('\n') : 'No files found';
        } catch (error) {
          return `Error listing files: ${error.message}`;
        }
      },
    }),

    new DynamicStructuredTool({
      name: 'runCommand',
      description: 'Execute a shell command in the workspace. Each command can only run ONCE.',
      schema: z.object({
        command: z.string().describe('The shell command to execute, e.g. "npm install"'),
      }),
      func: async ({ command }) => {
        try {
          let actualCommand = command.trim().replace(/\s+/g, ' ');

          // Auto-add --legacy-peer-deps to npm install to avoid peer dependency conflicts
          if (actualCommand === 'npm install' || actualCommand === 'npm i') {
            actualCommand = 'npm install --legacy-peer-deps';
          }

          const normalizedCmd = actualCommand.replace(/\s+/g, ' ');

          if (executedCommands.has(normalizedCmd)) {
            logger.info(`Command already executed, skipping: ${actualCommand}`);
            return `Command already executed. Move on to the next task.`;
          }

          if (normalizedCmd.includes('npm install') && executedCommands.size > 0) {
            const hasNpmInstall = Array.from(executedCommands).some(cmd => cmd.includes('npm install'));
            if (hasNpmInstall) {
              // Verify dependencies are actually installed
              const verification = await dockerUtils.verifyDependencies(containerId);
              if (verification.installed) {
                return 'npm install was already run. Dependencies are installed.';
              } else {
                logger.warn('npm install was run but dependencies not found, retrying...');
                // Remove from executed commands to allow retry
                executedCommands.delete(normalizedCmd);
              }
            }
          }

          executedCommands.add(normalizedCmd);

          // Increase timeout for npm install (5 minutes, configurable)
          const npmInstallTimeout = parseInt(process.env.NPM_INSTALL_TIMEOUT) || 300000; // 5 minutes default
          const timeout = normalizedCmd.includes('npm install') ? npmInstallTimeout : 30000;
          const isNpmInstall = normalizedCmd.includes('npm install');
          const maxRetries = isNpmInstall ? (parseInt(process.env.NPM_INSTALL_MAX_RETRIES) || 2) : 0;

          // Retry logic for npm install
          let lastError = null;
          let lastResult = null;

          for (let attempt = 0; attempt <= maxRetries; attempt++) {
            if (attempt > 0) {
              const retryDelay = Math.min(10000 * Math.pow(2, attempt - 1), 30000); // Exponential backoff, max 30s
              logger.info(`Retrying npm install (attempt ${attempt + 1}/${maxRetries + 1}) after ${retryDelay}ms delay...`);
              onUpdate?.({
                action: 'log',
                message: `Retrying npm install (attempt ${attempt + 1}/${maxRetries + 1})...`,
                ephemeral: true
              });
              await new Promise(resolve => setTimeout(resolve, retryDelay));
            }

            lastResult = await dockerUtils.execCommand(containerId, actualCommand, {
              timeout,
              onData: (data) => {
                // Send streaming updates
                onUpdate?.({
                  action: 'log',
                  message: data,
                  ephemeral: true
                });
              }
            });

            // Check if command succeeded
            if (lastResult.exitCode === 0) {
              // For npm install, verify dependencies were actually installed
              if (isNpmInstall) {
                const verification = await dockerUtils.verifyDependencies(containerId);
                if (verification.installed) {
                  onUpdate?.({ action: 'runCommand', command: actualCommand, success: true });
                  logger.info(`Agent ran command successfully: ${actualCommand}`);
                  return `Command completed successfully. Dependencies verified: ${verification.packagesFound.join(', ')}.`;
                } else {
                  // Installation completed but dependencies not found - might be a real error
                  if (attempt < maxRetries) {
                    lastError = `npm install completed but dependencies not found. Missing: ${verification.missingPackages.join(', ')}. Retrying...`;
                    logger.warn(lastError);
                    continue;
                  } else {
                    return `Command completed but dependencies verification failed. Missing: ${verification.missingPackages.join(', ')}. Output: ${lastResult.output}`;
                  }
                }
              } else {
                // Non-npm install command succeeded
                onUpdate?.({ action: 'runCommand', command: actualCommand, success: true });
                logger.info(`Agent ran command successfully: ${actualCommand}`);
                return lastResult.output || 'Command completed successfully.';
              }
            } else {
              // Command failed
              const isTimeout = lastResult.error === 'Command timed out' || lastResult.exitCode === -1;
              const errorMsg = lastResult.error || lastResult.output || '';

              // Check for esbuild EACCES error and auto-fix
              if (isNpmInstall && errorMsg.includes('esbuild/bin/esbuild') && errorMsg.includes('EACCES') && attempt < maxRetries) {
                logger.warn('Detected esbuild EACCES error in agent, attempting auto-fix...');
                onUpdate?.({
                  action: 'log',
                  message: 'Fixing esbuild permissions and retrying...',
                  ephemeral: false
                });

                // Fix esbuild permissions
                const fixResult = await dockerUtils.fixEsbuildPermissions(containerId);

                if (fixResult.success) {
                  logger.info('esbuild permissions fixed, retrying npm install...');
                  // Don't increment attempt counter, just retry
                  continue;
                } else {
                  logger.warn(`Could not fix esbuild permissions: ${fixResult.message}`);
                  // Continue to normal retry logic
                }
              }

              if (isTimeout && attempt < maxRetries) {
                lastError = `Command timed out after ${timeout}ms. Retrying...`;
                logger.warn(lastError);
                continue;
              } else {
                // Final attempt failed or non-timeout error
                onUpdate?.({ action: 'runCommand', command: actualCommand, success: false });
                const finalErrorMsg = isTimeout
                  ? `Command timed out after ${timeout}ms (${attempt + 1} attempts). This may indicate slow network or many dependencies.`
                  : `Command failed: ${errorMsg}`;
                return finalErrorMsg;
              }
            }
          }

          // Should not reach here, but handle it
          return `Command failed after ${maxRetries + 1} attempts: ${lastError || lastResult?.error || 'Unknown error'}`;
        } catch (error) {
          logger.error(`Error running command: ${error.message}`);
          return `Error running command: ${error.message}`;
        }
      },
    }),

    new DynamicStructuredTool({
      name: 'searchPhotos',
      description: 'Search for high-quality professional photos on Unsplash. Returns a list of photo objects with URLs and descriptions. Use these for <img> tags in your website.',
      schema: z.object({
        query: z.string().describe('The search query for images, e.g. "coffee shop", "modern office", "nature"'),
        perPage: z.number().default(5).describe('Number of photos to return (default 5)'),
      }),
      func: async ({ query, perPage }) => {
        try {
          const photos = await unsplashService.searchPhotos(query, perPage);
          onUpdate?.({ action: 'searchPhotos', query, count: photos.length, success: true });
          return JSON.stringify(photos, null, 2);
        } catch (error) {
          logger.error(`searchPhotos error: ${error.message}`);
          return `Error searching photos: ${error.message}`;
        }
      },
    }),
  ];

  // Different system prompts based on mode
  const createModePrompt = `You are an ELITE frontend developer known for creating stunning, award-winning websites. Create PRODUCTION-QUALITY React applications.

IMPORTANT: The workspace already has a Vite + React template with:
- package.json (react, react-dom, vite, @vitejs/plugin-react)
- vite.config.js (configured for React)
- index.html (with Tailwind CDN)
- src/main.jsx (React entry point)
- src/App.jsx (basic component)
- node_modules (dependencies pre-installed)

AVAILABLE TOOLS:
- writeFile: Create new files
- readFile: Read existing files
- updateFile: Update existing files
- listFiles: List project structure
- runCommand: Execute shell commands
- searchPhotos: Search for high-quality images from Unsplash (USE THESE FOR STUNNING VISUALS)

CRITICAL RULES:
1. DO NOT create package.json, vite.config.js, index.html, or main.jsx - they already exist
2. DO NOT run "npm install" - dependencies are already installed
3. DO NOT run "npm run dev" - server starts automatically
4. ONLY modify or create files in /workspace/src/ folder
5. Use writeFile to create NEW component files
6. Use updateFile to modify EXISTING files (read first with readFile)

WORKFLOW:
1. First, use listFiles to see current project structure
2. Read /workspace/src/App.jsx to see the current code
3. Create your application by updating /workspace/src/App.jsx with a COMPLETE, STUNNING design
4. DONE - respond with summary

=== DESIGN REQUIREMENTS (CRITICAL - FOLLOW EXACTLY) ===

CREATE VISUALLY STUNNING, PROFESSIONAL WEBSITES WITH:

1. MODERN COLOR SCHEME:
   - Use gradient backgrounds: bg-gradient-to-r, bg-gradient-to-br
   - Dark theme: bg-gray-900, bg-slate-900, bg-zinc-900
   - Accent colors: blue-500, purple-500, cyan-500, emerald-500
   - Text: text-white, text-gray-100, text-gray-400

2. BEAUTIFUL NAVBAR (REQUIRED):
   - Sticky/fixed position: fixed top-0 w-full z-50
   - Glassmorphism: bg-white/10 backdrop-blur-md
   - Logo on left, nav links on right
   - Mobile hamburger menu with useState
   - Hover effects: hover:text-blue-400 transition-colors

3. HERO SECTION (REQUIRED):
   - Full viewport height: min-h-screen
   - Gradient background or animated gradient
   - Large bold heading with gradient text: bg-clip-text text-transparent bg-gradient-to-r
   - Animated typing effect or fade-in animations
   - Call-to-action buttons with hover effects
   - Floating/animated decorative elements

4. ANIMATIONS (USE THESE):
   - Fade in: animate-fade-in (define with @keyframes in style tag)
   - Slide up: animate-slide-up
   - Pulse: animate-pulse
   - Bounce: animate-bounce
   - Hover scale: hover:scale-105 transition-transform duration-300
   - Hover glow: hover:shadow-lg hover:shadow-blue-500/25

5. CARDS & COMPONENTS:
   - Glassmorphism cards: bg-white/5 backdrop-blur-sm border border-white/10
   - Rounded corners: rounded-2xl or rounded-3xl
   - Shadows: shadow-xl shadow-black/20
   - Hover effects: hover:-translate-y-2 transition-all duration-300
   - Icons using emoji or Unicode symbols

6. SECTIONS TO INCLUDE:
   - Hero with animated text and CTA
   - About/Bio section with image placeholder
   - Skills/Technologies with icon cards
   - Projects grid with beautiful cards (image, title, description, links)
   - Testimonials or achievements

9. IMAGES (REQUIRED):
   - Use the searchPhotos tool to find relevant, high-quality images
   - Use real Unsplash URLs in <img> tags
   - Add proper alt descriptions
   - Use object-cover and rounded-xl for beautiful image presentation
   - Testimonials or achievements
   - Contact section with form or social links
   - Footer with links and copyright

7. RESPONSIVE DESIGN:
   - Mobile first: base styles for mobile
   - Tablet: md: prefix
   - Desktop: lg: prefix
   - Grid: grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3

8. TYPOGRAPHY:
   - Large headings: text-4xl md:text-5xl lg:text-6xl font-bold
   - Gradient text: bg-clip-text text-transparent bg-gradient-to-r from-blue-400 to-purple-500
   - Body text: text-gray-300 text-lg leading-relaxed

EXAMPLE CODE PATTERNS:

// Animated gradient text
<h1 className="text-5xl md:text-7xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-blue-400 via-purple-500 to-pink-500">
  John Doe
</h1>

// Glassmorphism card with hover
<div className="bg-white/5 backdrop-blur-sm border border-white/10 rounded-2xl p-6 hover:-translate-y-2 hover:shadow-xl hover:shadow-purple-500/10 transition-all duration-300">

// Gradient button
<button className="px-8 py-3 bg-gradient-to-r from-blue-500 to-purple-600 rounded-full font-semibold hover:shadow-lg hover:shadow-blue-500/25 transition-all duration-300 hover:scale-105">

// Sticky navbar with glassmorphism
<nav className="fixed top-0 w-full z-50 bg-black/20 backdrop-blur-md border-b border-white/10">

// Custom animations - use inline style tag with template literal
// Example: Add animations using Tailwind's built-in: animate-pulse, animate-bounce
// Or use CSS transitions: transition-all duration-300 ease-in-out

CREATE A COMPLETE, PRODUCTION-READY WEBSITE - NOT A BASIC TEMPLATE!

Workspace path: /workspace`;

  const updateModePrompt = `You are an ELITE frontend developer. Enhance and improve EXISTING code with stunning visuals.

RULES:
1. Use listFiles first to see project structure
2. Use readFile to read files BEFORE modifying them
3. Use updateFile (NOT writeFile) to modify existing files
4. Only modify files that need changes
5. Do NOT run npm install unless adding new packages
6. Do NOT recreate package.json, vite.config.js, main.jsx, index.html

WORKFLOW:
1. listFiles /workspace - see structure
2. readFile the files you need to modify
3. updateFile with your changes
4. DONE - respond with what you changed

DESIGN ENHANCEMENTS (APPLY THESE):
- Gradient backgrounds: bg-gradient-to-r from-blue-500 to-purple-600
- Glassmorphism: bg-white/10 backdrop-blur-md border border-white/10
- Animations: hover:scale-105, hover:-translate-y-2, transition-all duration-300
- Shadows with color: shadow-xl shadow-purple-500/20
- Gradient text: bg-clip-text text-transparent bg-gradient-to-r
- Smooth transitions on all interactive elements
- Modern rounded corners: rounded-2xl, rounded-3xl
- Professional spacing: generous padding and margins

Example for "improve UI":
1. listFiles /workspace
2. readFile /workspace/src/App.jsx
3. updateFile /workspace/src/App.jsx with improved responsive design
4. DONE

Current workspace: /workspace (EXISTING PROJECT - do not recreate)`;

  const systemPrompt = mode === AgentMode.UPDATE ? updateModePrompt : createModePrompt;

  const prompt = ChatPromptTemplate.fromMessages([
    ['system', systemPrompt],
    ['human', '{input}'],
    new MessagesPlaceholder('agent_scratchpad'),
  ]);

  return { llm, tools, prompt };
}

/**
 * Execute the code agent with a user prompt
 * @param {string} containerId - Docker container ID
 * @param {string} userPrompt - User's request
 * @param {function} onUpdate - Callback for progress updates
 * @param {string} mode - Agent mode: 'create' or 'update'
 */
async function executeAgent(containerId, userPrompt, onUpdate, mode = AgentMode.CREATE) {
  const { llm, tools, prompt } = createCodeAgent(containerId, onUpdate, mode);

  try {
    onUpdate?.({ action: 'agentStart', message: mode === AgentMode.UPDATE ? 'Updating project...' : 'Creating project...' });

    const agent = await createOpenAIFunctionsAgent({
      llm,
      tools,
      prompt,
    });

    const executor = new AgentExecutor({
      agent,
      tools,
      verbose: true,
      maxIterations: 25,
      returnIntermediateSteps: true,
      // Handle parsing errors gracefully instead of crashing
      handleParsingErrors: (error) => {
        logger.warn('Agent parsing error:', error.message);
        return `Error parsing response. Please try again with valid tool input format.`;
      },
    });

    const result = await executor.invoke({
      input: userPrompt,
    });

    // Check if agent stopped due to max iterations
    if (result.intermediateSteps?.length >= 25) {
      logger.warn('Agent stopped due to max iterations');
      onUpdate?.({ action: 'agentComplete', message: 'Agent stopped due to max iterations.', result: result.output || 'Task incomplete - iteration limit reached.' });
    } else {
      onUpdate?.({ action: 'agentComplete', message: 'AI Agent completed', result: result.output });
    }
    logger.info('Agent execution completed');

    return {
      success: true,
      output: result.output,
    };
  } catch (error) {
    logger.error('Agent execution error:', error);
    onUpdate?.({ action: 'agentError', message: error.message });
    return {
      success: false,
      error: error.message,
    };
  }
}

module.exports = {
  createCodeAgent,
  executeAgent,
  AgentMode,
};
