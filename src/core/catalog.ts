export interface CatalogEntry { name: string; description: string; category: string; }

export function parseCatalog(raw: string, kind: 'tools' | 'agents'): CatalogEntry[] {
  const data = JSON.parse(raw);
  const groups = kind === 'tools'
    ? [{ category: 'Tool', values: data.tools }]
    : [{ category: 'Worker', values: data.worker_agents?.agents }, { category: 'Council', values: data.council_agents?.agents }];
  return groups.flatMap(group => {
    if (!Array.isArray(group.values) || group.values.length > 500) throw new Error('Unsupported Veto catalog response');
    return group.values.map((value: unknown) => {
      if (!value || typeof value !== 'object') throw new Error('Invalid catalog entry');
      const record = value as Record<string, unknown>;
      const name = kind === 'tools' ? record.name : record.id;
      const description = kind === 'tools' ? record.description : record.role;
      if (typeof name !== 'string' || !/^[a-zA-Z0-9_-]{1,128}$/.test(name) || typeof description !== 'string' || description.length > 32000) {
        throw new Error('Invalid catalog entry');
      }
      return { name, description, category: group.category };
    });
  });
}
