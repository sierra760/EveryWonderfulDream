// Build-time access to the atlas summary (server side only: used in page frontmatter).
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Summary } from './data';

export type FullSummary = Summary & {
  classifications: number;
  withNames: number;
  withImages: number;
  unplaced: number;
  derived: number;
  withDates: number;
  patentees: number;
  nameLetters: Record<string, number>;
  sizes: Record<string, number>;
};

let cached: FullSummary | null = null;

export function loadSummary(): FullSummary {
  cached ??= JSON.parse(readFileSync(join(process.cwd(), 'public', 'data', 'summary.json'), 'utf8')) as FullSummary;
  return cached;
}
