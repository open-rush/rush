import { describe, expect, it } from 'vitest';
import { TemplateRegistry } from '../template/template-registry.js';

describe('TemplateRegistry', () => {
  it('has 3 built-in templates', () => {
    const registry = new TemplateRegistry();
    expect(registry.list()).toHaveLength(3);
  });

  it('includes simple-html', () => {
    const registry = new TemplateRegistry();
    const t = registry.get('simple-html');
    expect(t).toBeDefined();
    expect(t?.category).toBe('static');
    expect(t?.files['index.html']).toContain('<!DOCTYPE html>');
  });

  it('includes react-tailwind', () => {
    const registry = new TemplateRegistry();
    const t = registry.get('react-tailwind');
    expect(t).toBeDefined();
    expect(t?.category).toBe('spa');
    expect(t?.dependencies?.react).toBeDefined();
  });

  it('includes nextjs-fullstack', () => {
    const registry = new TemplateRegistry();
    const t = registry.get('nextjs-fullstack');
    expect(t).toBeDefined();
    expect(t?.category).toBe('fullstack');
    expect(t?.dependencies?.next).toBeDefined();
  });

  it('registers custom template', () => {
    const registry = new TemplateRegistry();
    registry.register({
      id: 'custom',
      name: 'Custom',
      description: 'Custom template',
      category: 'static',
      files: { 'index.html': '<h1>Custom</h1>' },
    });
    expect(registry.has('custom')).toBe(true);
    expect(registry.list()).toHaveLength(4);
  });

  it('rejects duplicate template id', () => {
    const registry = new TemplateRegistry();
    expect(() =>
      registry.register({
        id: 'simple-html',
        name: 'Dupe',
        description: 'Duplicate',
        category: 'static',
        files: {},
      })
    ).toThrow('already registered');
  });

  it('filters by category', () => {
    const registry = new TemplateRegistry();
    const static_ = registry.listByCategory('static');
    expect(static_).toHaveLength(1);
    expect(static_[0].id).toBe('simple-html');
  });

  it('returns undefined for unknown template', () => {
    const registry = new TemplateRegistry();
    expect(registry.get('nonexistent')).toBeUndefined();
  });

  it('generates package.json', () => {
    const registry = new TemplateRegistry();
    const json = registry.generatePackageJson('react-tailwind', 'my-app');
    const pkg = JSON.parse(json);
    expect(pkg.name).toBe('my-app');
    expect(pkg.dependencies.react).toBeDefined();
    expect(pkg.scripts.dev).toBe('vite');
  });

  it('generates package.json for simple-html (no deps)', () => {
    const registry = new TemplateRegistry();
    const json = registry.generatePackageJson('simple-html', 'my-site');
    const pkg = JSON.parse(json);
    expect(pkg.name).toBe('my-site');
    expect(pkg.dependencies).toBeUndefined();
  });

  it('returns defensive copies — mutation does not pollute registry', () => {
    const registry = new TemplateRegistry();
    const t1 = registry.get('simple-html');
    t1!.files['index.html'] = 'TAMPERED';
    t1!.name = 'HACKED';

    const t2 = registry.get('simple-html');
    expect(t2!.files['index.html']).toContain('<!DOCTYPE html>');
    expect(t2!.name).toBe('Simple HTML');

    const list = registry.list();
    list[0].name = 'TAMPERED_LIST';
    expect(registry.list()[0].name).not.toBe('TAMPERED_LIST');
  });

  it('throws when generating for unknown template', () => {
    const registry = new TemplateRegistry();
    expect(() => registry.generatePackageJson('unknown', 'x')).toThrow('not found');
  });
});
