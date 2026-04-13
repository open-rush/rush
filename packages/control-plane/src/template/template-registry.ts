export interface ProjectTemplate {
  id: string;
  name: string;
  description: string;
  category: 'static' | 'spa' | 'fullstack';
  defaultModel?: string;
  files: Record<string, string>;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  scripts?: Record<string, string>;
}

const BUILTIN_TEMPLATES: ProjectTemplate[] = [
  {
    id: 'simple-html',
    name: 'Simple HTML',
    description: 'Minimal HTML/CSS/JS starter',
    category: 'static',
    files: {
      'index.html':
        '<!DOCTYPE html>\n<html lang="en">\n<head>\n  <meta charset="UTF-8">\n  <meta name="viewport" content="width=device-width, initial-scale=1.0">\n  <title>My Project</title>\n  <link rel="stylesheet" href="style.css">\n</head>\n<body>\n  <h1>Hello, World!</h1>\n  <script src="main.js"></script>\n</body>\n</html>',
      'style.css': 'body {\n  font-family: system-ui, sans-serif;\n  margin: 2rem;\n}\n',
      'main.js': "console.log('Hello from Lux!');\n",
    },
  },
  {
    id: 'react-tailwind',
    name: 'React + Tailwind',
    description: 'React 19 with Tailwind CSS and Vite',
    category: 'spa',
    defaultModel: 'claude-sonnet-4-6',
    files: {
      'index.html':
        '<!DOCTYPE html>\n<html lang="en">\n<head>\n  <meta charset="UTF-8">\n  <meta name="viewport" content="width=device-width, initial-scale=1.0">\n  <title>React App</title>\n</head>\n<body>\n  <div id="root"></div>\n  <script type="module" src="/src/main.tsx"></script>\n</body>\n</html>',
      'src/main.tsx':
        "import React from 'react';\nimport ReactDOM from 'react-dom/client';\nimport App from './App';\nimport './index.css';\n\nReactDOM.createRoot(document.getElementById('root')!).render(\n  <React.StrictMode>\n    <App />\n  </React.StrictMode>\n);\n",
      'src/App.tsx':
        'export default function App() {\n  return (\n    <div className="min-h-screen flex items-center justify-center bg-gray-50">\n      <h1 className="text-4xl font-bold text-gray-900">Hello, React!</h1>\n    </div>\n  );\n}\n',
      'src/index.css': "@import 'tailwindcss';\n",
    },
    dependencies: {
      react: '^19.0.0',
      'react-dom': '^19.0.0',
    },
    devDependencies: {
      '@vitejs/plugin-react': '^4.0.0',
      tailwindcss: '^4.0.0',
      typescript: '^5.8.0',
      vite: '^6.0.0',
    },
    scripts: {
      dev: 'vite',
      build: 'vite build',
      preview: 'vite preview',
    },
  },
  {
    id: 'nextjs-fullstack',
    name: 'Next.js Fullstack',
    description: 'Next.js 15 with App Router',
    category: 'fullstack',
    defaultModel: 'claude-sonnet-4-6',
    files: {
      'app/layout.tsx':
        "import type { Metadata } from 'next';\n\nexport const metadata: Metadata = {\n  title: 'My App',\n  description: 'Built with Lux',\n};\n\nexport default function RootLayout({ children }: { children: React.ReactNode }) {\n  return (\n    <html lang=\"en\">\n      <body>{children}</body>\n    </html>\n  );\n}\n",
      'app/page.tsx':
        "export default function Home() {\n  return (\n    <main style={{ padding: '2rem', fontFamily: 'system-ui' }}>\n      <h1>Hello, Next.js!</h1>\n    </main>\n  );\n}\n",
    },
    dependencies: {
      next: '^15.0.0',
      react: '^19.0.0',
      'react-dom': '^19.0.0',
    },
    devDependencies: {
      typescript: '^5.8.0',
      '@types/react': '^19.0.0',
    },
    scripts: {
      dev: 'next dev',
      build: 'next build',
      start: 'next start',
    },
  },
];

export class TemplateRegistry {
  private templates = new Map<string, ProjectTemplate>();

  constructor() {
    for (const template of BUILTIN_TEMPLATES) {
      this.templates.set(template.id, structuredClone(template));
    }
  }

  register(template: ProjectTemplate): void {
    if (this.templates.has(template.id)) {
      throw new Error(`Template '${template.id}' already registered`);
    }
    this.templates.set(template.id, structuredClone(template));
  }

  get(id: string): ProjectTemplate | undefined {
    const t = this.templates.get(id);
    return t ? structuredClone(t) : undefined;
  }

  list(): ProjectTemplate[] {
    return Array.from(this.templates.values()).map((t) => structuredClone(t));
  }

  listByCategory(category: ProjectTemplate['category']): ProjectTemplate[] {
    return this.list().filter((t) => t.category === category);
  }

  has(id: string): boolean {
    return this.templates.has(id);
  }

  generatePackageJson(templateId: string, projectName: string): string {
    const template = this.get(templateId);
    if (!template) throw new Error(`Template '${templateId}' not found`);

    const pkg: Record<string, unknown> = {
      name: projectName,
      version: '0.0.0',
      private: true,
    };

    if (template.scripts) pkg.scripts = template.scripts;
    if (template.dependencies) pkg.dependencies = template.dependencies;
    if (template.devDependencies) pkg.devDependencies = template.devDependencies;

    return JSON.stringify(pkg, null, 2);
  }
}
