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

# Create package.json for template
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
    "react-dom": "^18.2.0"\
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

# Create src directory and files
RUN mkdir -p /template/src

RUN echo 'import React from "react";\
import ReactDOM from "react-dom/client";\
import App from "./App.jsx";\
\
ReactDOM.createRoot(document.getElementById("root")).render(\
  <React.StrictMode>\
    <App />\
  </React.StrictMode>\
);' > /template/src/main.jsx

RUN echo 'import React from "react";\
\
function App() {\
  return (\
    <div className="min-h-screen bg-gray-100 flex items-center justify-center">\
      <h1 className="text-4xl font-bold text-gray-800">Hello World</h1>\
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