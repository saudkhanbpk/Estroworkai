const { ChatOpenAI } = require('@langchain/openai');
const { AgentExecutor, createOpenAIFunctionsAgent } = require('langchain/agents');
const { DynamicStructuredTool } = require('@langchain/core/tools');
const { ChatPromptTemplate, MessagesPlaceholder } = require('@langchain/core/prompts');
const { z } = require('zod');
const dockerUtils = require('../utils/docker');
const logger = require('../utils/logger');

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
              return 'npm install was already run. Dependencies are installed.';
            }
          }

          executedCommands.add(normalizedCmd);
          // Increase timeout for npm install (can take a while)
          const timeout = normalizedCmd.includes('npm install') ? 120000 : 30000;

          const result = await dockerUtils.execCommand(containerId, actualCommand, {
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

          onUpdate?.({ action: 'runCommand', command: actualCommand, success: result.exitCode === 0 });
          logger.info(`Agent ran command: ${actualCommand}`);

          if (result.exitCode !== 0) {
            return `Command failed: ${result.error || result.output}`;
          }
          return result.output || 'Command completed successfully.';
        } catch (error) {
          return `Error running command: ${error.message}`;
        }
      },
    }),
  ];

  // Different system prompts based on mode
  const createModePrompt = `You are an expert web developer. Create complete, working React applications.

CRITICAL RULES:
1. Use writeFile to create files - DO NOT output code as text
2. DO NOT use npx, npm init, or any CLI scaffolding commands
3. After creating ALL files, run "npm install" ONCE
4. Do NOT run "npm run dev" - server starts automatically
5. Use EXACT versions specified below to avoid dependency conflicts

DESIGN REQUIREMENTS:
- Mobile-first responsive design with Tailwind CSS
- Use Tailwind classes: sm:, md:, lg: for breakpoints
- Modern UI: rounded-lg, shadow-md, hover effects, transitions

CREATE THESE FILES IN ORDER:

1. /workspace/package.json (use these EXACT versions):
Name: use project name, type: module
Scripts: dev: vite, build: vite build, preview: vite preview
Dependencies: react: 18.2.0, react-dom: 18.2.0
DevDependencies: vite: 5.0.0, @vitejs/plugin-react: 4.2.0

2. /workspace/vite.config.js:
Import defineConfig from vite, import react from @vitejs/plugin-react
Export default defineConfig with plugins: [react()]

3. /workspace/index.html:
DOCTYPE html, lang en, meta charset utf-8, meta viewport
Title, div id root, script type module src /src/main.jsx
Add Tailwind CDN: script src https://cdn.tailwindcss.com

4. /workspace/src/main.jsx:
Import React, ReactDOM, App, render App to root

5. /workspace/src/App.jsx:
Create the main component with full responsive Tailwind styling

6. Run command: npm install

7. DONE - respond with summary of what was created

Workspace path: /workspace`;

  const updateModePrompt = `You are an expert web developer. Modify EXISTING code - do NOT recreate the project.

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

DESIGN IMPROVEMENTS (when asked to improve UI):
- Use Tailwind responsive classes: sm:, md:, lg:
- Add hover states, transitions, shadows
- Use flexbox/grid for layouts
- Better spacing and visual hierarchy

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
