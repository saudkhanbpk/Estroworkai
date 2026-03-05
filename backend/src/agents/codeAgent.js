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
    model: 'gpt-4o-mini',
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
  const createModePrompt = `You are a WORLD-CLASS Frontend Architect. YOUR GOAL IS AN AWARD-WINNING, LUXURY WEBSITE.

=== CRITICAL EXECUTION RULES ===
1. NO CHAT, NO MARKDOWN, NO EXPLANATIONS.
2. YOU MUST USE TOOLS. Do not print code in text.
3. If you want to create a file, use the 'writeFile' tool.
4. If you want to search images, use 'searchPhotos'.
5. DO NOT say "I will create...": JUST CREATE IT.

=== MANDATORY DELIVERABLES (YOU MUST CREATE ALL OF THESE) ===
1. Pages (in /workspace/src/pages/):
   - Home.jsx (REQUIRED - MUST have Hero section with image + 15-20 word intro)
   - About.jsx (REQUIRED)
   - Contact.jsx (REQUIRED)
   - Services.jsx OR Menu.jsx OR Products.jsx (REQUIRED - based on user's request)
   
2. Components (in /workspace/src/components/):
   - Navbar.jsx (REQUIRED)
   - Footer.jsx (REQUIRED)
   
3. App Integration:
   - Update App.jsx to import ALL pages and components
   - Create <Route> for EVERY page you created
   - Render Navbar and Footer in App.jsx

=== CRITICAL RULES (VIOLATIONS = PROJECT FAILURE) ===
1. FOOTER IS COMPULSORY: You MUST create Footer.jsx and render it in App.jsx.
2. ALL PAGES ARE COMPULSORY: If you create a navbar link to "/about", you MUST create About.jsx.
3. IMAGES ARE COMPULSORY: Every page, hero, feature, item and card MUST have a real image. Use searchPhotos tool.
4. NO PLACEHOLDERS - ABSOLUTE BAN: 
   - NEVER EVER use comments like {{/* ... will go here */}}, {{/* ... */}}, {{/* Add content */}}
   - NEVER leave empty grids or sections
   - EVERY grid MUST be populated with a real data array (6+ items minimum)
   - Example BANNED code: {{/* Blog posts will go here */}}
   - Example CORRECT code: const posts = [{{...}}, {{...}}, {{...}}]; posts.map(...)
   - If you create a grid, you MUST fill it with real content immediately
5. NO TOOL IMPORTS: NEVER import "searchPhotos" or "../utils/photoService" into React code.
6. SAFE ICONS ONLY: Use ONLY these icons: ArrowRight, Check, ChevronRight, Star, ShoppingBag, Phone, Mail, MapPin, Instagram, Facebook, Twitter, Linkedin, Search, Menu, X, ExternalLink, Play, Pause, Home, User, Settings, Heart, Clock, Calendar, Mouse, Smartphone, Monitor, Coffee, Leaf, Info, Briefcase, Rocket.
7. NO DUPLICATE ROUTERS: NEVER add <BrowserRouter> to App.jsx. It exists in main.jsx.
8. MANDATORY ICON IMPORTS (FORGETTING = CRASH):
   Before writing ANY component code:
   - List EVERY icon you will use (Check, Star, Coffee, ArrowRight, etc.)
   - Write this import at THE TOP: import {{ Icon1, Icon2, Icon3 }} from "lucide-react";
   - Include ALL icons from your list
   - Example: Using Check and Star? → import {{ Check, Star }} from "lucide-react";
   - Then write the rest of your component
   - WRONG (causes crash): \u003cCheck /\u003e without import
   - CORRECT: import {{ Check }} from "lucide-react"; THEN \u003cCheck /\u003e

=== STEP-BY-STEP WORKFLOW (FOLLOW IN ORDER) ===
STEP 1: RESEARCH
- Call listFiles to see /workspace structure
- Call searchPhotos to get 20+ images for ALL sections

STEP 2: CREATE ALL PAGES (DO NOT SKIP ANY)
- Use writeFile to create Home.jsx:
  * MUST have Hero section (full viewport height, bg image, 15-20 word intro, CTA button)
  * Add features/services section with images
- Use writeFile to create About.jsx with team/story + images
- Use writeFile to create Contact.jsx with form + map/contact info + images  
- Use writeFile to create Services.jsx (or Menu.jsx/Products.jsx) with grid + images

STEP 3: CREATE COMPONENTS
- Use writeFile to create Navbar.jsx with glassmorphism design
- Use writeFile to create Footer.jsx with 3-4 columns (Brand, Links, Contact, Social)

STEP 4: INTEGRATE IN APP.JSX
- Use readFile to read /workspace/src/App.jsx
- Use updateFile to:
  * Import ALL pages you created
  * Import Navbar and Footer
  * Create <Route> for EVERY page
  * Render Navbar, Routes, and Footer

STEP 5: VERIFY
- Confirm you created ALL pages listed in navbar links
- Confirm every page has real images
- Confirm Footer exists and is rendered

=== DESIGN STANDARDS ===
COLOR COMBINATION WHITELIST (YOU MAY ONLY USE THESE - ALL OTHERS ARE FORBIDDEN):

YOU ARE ONLY ALLOWED TO USE THESE 5 APPROVED COMBINATIONS:

COMBINATION 1 - Light Section:
  Background: bg-white OR bg-slate-50 OR bg-gray-50
  Headings: text-slate-950 OR text-black
  Body Text: text-slate-700 OR text-gray-700
  
COMBINATION 2 - Dark Section:
  Background: bg-black OR bg-slate-900 OR bg-gray-900
  Headings: text-white
  Body Text: text-slate-300 OR text-gray-300
  
COMBINATION 3 - Hero with Image:
  Background: \u003cimg\u003e + \u003cdiv className="absolute inset-0 bg-black/50"\u003e overlay
  All Text: text-white
  
COMBINATION 4 - White Card:
  Background: bg-white
  Headings: text-slate-950
  Body Text: text-slate-700
  
COMBINATION 5 - Navbar Light (DEFAULT):
  Background: bg-white/80 backdrop-blur-md
  Text: text-slate-950
  Links: text-slate-600 hover:text-black

CRITICAL ENFORCEMENT:
- You CANNOT use ANY color combination not listed above
- If you want dark text, you MUST use COMBINATION 1 or 4 (light backgrounds)
- If you want light text, you MUST use COMBINATION 2 or 3 (dark backgrounds)
- There are NO exceptions to this rule
- If uncertain, use COMBINATION 1 (light section)

FAILURE TO USE WHITELIST = PROJECT REJECTION

RESPONSIVE DESIGN PRINCIPLES:
1. PADDING: Use Tailwind responsive padding classes. Mobile should have minimum px-2, larger screens px-6+.
   - Pattern: px-2 sm:px-4 md:px-6 lg:px-8
   - NEVER allow padding to be 0 on any screen size

2. TYPOGRAPHY: Use responsive text sizing. Smaller on mobile, larger on desktop.
   - Pattern: text-4xl sm:text-5xl md:text-6xl (for hero headings)
   - Pattern: text-2xl sm:text-3xl md:text-4xl (for section headings)
   - Pattern: text-base sm:text-lg (for body text)

3. LAYOUT: Use responsive grid columns.
   - Pattern: grid-cols-1 sm:grid-cols-2 md:grid-cols-3
   - Ensure content flows well on mobile (single column) and desktop (multi-column)

4. NAVBAR: Must work on all screens.
   - Mobile: Show hamburger Menu icon, hide navigation links
   - Desktop (md+): Hide hamburger, show full navigation links
   - Use hidden md:flex for desktop links, md:hidden for hamburger

PREMIUM STYLING REQUIREMENTS:
- Navbar: fixed or sticky, glassmorphism (bg-white/80 backdrop-blur-md)
- Cards: rounded-3xl, shadow-2xl, smooth hover effects
- Spacing: Generous section padding (py-16 to py-24), max-w-7xl containers
- Typography: Bold headings (font-black), tight tracking, clean hierarchy
- Images: Always use high-quality photos from searchPhotos

COMPONENT STRUCTURE:
- Every card MUST include: image, icon, heading, description, call-to-action button
- Use subtle gradients for depth (bg-gradient-to-br from-slate-50 to-white)
- Populate grids with 6+ real items (no placeholders)


=== EXAMPLE PATTERN (USE AS REFERENCE, NOT AS EXACT CODE) ===
// Hero Section Pattern:
<div className="relative min-h-screen flex items-center justify-center">
  <img src={{heroImage}} className="absolute inset-0 w-full h-full object-cover" />
  <div className="absolute inset-0 bg-black/50" />
  <div className="relative z-10 text-center px-2 sm:px-4 md:px-6 max-w-4xl mx-auto">
    <h1 className="text-4xl sm:text-5xl md:text-6xl lg:text-7xl font-black text-white mb-6">{{Heading}}</h1>
    <p className="text-lg sm:text-xl md:text-2xl text-white/90 mb-8">{{15-20 word intro}}</p>
    <button className="bg-white text-black px-8 py-4 rounded-full text-lg font-bold hover:bg-slate-100">{{CTA}}</button>
  </div>
</div>

// Responsive Section Pattern:
<section className="py-16 sm:py-20 md:py-24 px-2 sm:px-4 md:px-6 lg:px-8 max-w-7xl mx-auto">
  <h2 className="text-3xl sm:text-4xl md:text-5xl font-black text-slate-950 mb-12">{{Section Title}}</h2>
  <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-6 md:gap-10">
    {{/* Cards with images, icons, content */}}
  </div>
</section>

          {{items.map(item => (
            <div key={{item.id}} className="group rounded-3xl overflow-hidden shadow-2xl">
              <img src={{item.img}} className="w-full h-64 object-cover" />
              <div className="p-8 bg-white">
                <Coffee className="w-6 h-6 text-blue-600 mb-3" />
                <h3 className="text-2xl font-bold text-slate-950">{{item.name}}</h3>
                <p className="text-slate-600 my-4">{{item.desc}}</p>
                <button className="bg-black text-white px-6 py-3 rounded-full">Order Now</button>
              </div>
            </div>
          ))}}
        </div>
      </section>
    </div>
  );
}};

export default Menu;

FINAL CHECKLIST BEFORE FINISHING:
✓ Did you create Home.jsx, About.jsx, Contact.jsx, and Services/Menu/Products.jsx?
✓ Did you create Navbar.jsx and Footer.jsx?
✓ Did you update App.jsx with ALL routes and components?
✓ Does every page have real images from searchPhotos?
✓ Is the contrast high and text readable?

Workspace path: /workspace`;

  const updateModePrompt = `You are an ELITE frontend developer. Transform BASIC code into STUNNING, award-winning visuals.

    RULES:
1. Use listFiles first to see project structure
2. Use readFile to read files BEFORE modifying them
3. Use updateFile (NOT writeFile) to modify existing files
4. Only modify files that need changes
5. Do NOT run npm install unless adding new packages
6. Do NOT recreate package.json, vite.config.js, main.jsx, index.html
7. FIX BASIC DESIGNS: If you see simple text/white backgrounds, add grids, images, gradients, and shadows.
8. FIX CONTRAST: Ensure text is dark (slate-900) on light backgrounds.

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
- Professional spacing: generous padding and margins (py-24, px-8)

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
