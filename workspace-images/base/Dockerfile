FROM node:20

WORKDIR /workspace

# Allow npm postinstall scripts to run as root
ENV npm_config_unsafe_perm=true

# Install common development tools globally
RUN npm install -g serve nodemon typescript ts-node vite create-vite

# Install additional utilities
RUN apt-get update && apt-get install -y git curl procps && rm -rf /var/lib/apt/lists/*

# Create template directory with a pre-configured Vite React project
RUN mkdir -p /template

RUN echo '{\
  "name": "vite-react-template",\
  "private": true,\
  "version": "0.0.0",\
  "type": "module",\
  "scripts": {\
  "dev": "vite",\
  "build": "vite build",\
  "preview": "vite preview"\
  },\
  "dependencies": {\
  "react": "^18.2.0",\
  "react-dom": "^18.2.0",\
  "react-router-dom": "^6.22.0",\
  "lucide-react": "^0.344.0"\
  },\
  "devDependencies": {\
  "@vitejs/plugin-react": "^4.2.0",\
  "vite": "^5.0.0"\
  }\
  }' > /template/package.json

# Create vite.config.js
RUN echo 'import { defineConfig } from "vite";\
  import react from "@vitejs/plugin-react";\
  \
  export default defineConfig({\
  plugins: [react()],\
  server: {\
  host: "0.0.0.0",\
  port: 3000\
  }\
  });' > /template/vite.config.js

# Create index.html
RUN echo '<!DOCTYPE html>\
  <html lang="en">\
  <head>\
  <meta charset="UTF-8" />\
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />\
  <title>Vite + React</title>\
  <script src="https://cdn.tailwindcss.com"></script>\
  </head>\
  <body>\
  <div id="root"></div>\
  <script type="module" src="/src/main.jsx"></script>\
  </body>\
  </html>' > /template/index.html

# Create src directory and modular folders
RUN mkdir -p /template/src/pages /template/src/components /template/src/hooks

RUN echo 'import React from "react";\
  import ReactDOM from "react-dom/client";\
  import { BrowserRouter } from "react-router-dom";\
  import App from "./App.jsx";\
  \
  ReactDOM.createRoot(document.getElementById("root")).render(\
  <React.StrictMode>\
  <BrowserRouter>\
  <App />\
  </BrowserRouter>\
  </React.StrictMode>\
  );' > /template/src/main.jsx

RUN echo 'import React from "react";\
  import { Routes, Route } from "react-router-dom";\
  \
  function App() {\
  return (\
  <div className="min-h-screen bg-zinc-950 text-white flex items-center justify-center">\
  <div className="text-center space-y-6">\
  <h1 className="text-6xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-cyan-400 to-blue-600">\
  Estro AI Workspace\
  </h1>\
  <p className="text-zinc-400 text-xl">Ready to build your masterpiece.</p>\
  </div>\
  </div>\
  );\
  }\
  \
  export default App;' > /template/src/App.jsx

# Install dependencies in template (this is where npm install happens during image build)
WORKDIR /template
RUN npm install --legacy-peer-deps

# Reset workdir and create workspace directory
WORKDIR /workspace
RUN mkdir -p /workspace && chmod 777 /workspace

EXPOSE 3000

CMD ["tail", "-f", "/dev/null"]