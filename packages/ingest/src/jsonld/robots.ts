/** Minimal robots.txt parser (RFC 9309 semantics: longest match wins, Allow wins ties). Pure. */

export const ROBOTS_AGENT = 'hirelanebot';

export interface RobotsRules {
  sitemaps: string[];
  crawlDelayMs: number | null;
  isAllowed(pathAndQuery: string): boolean;
}

interface Rule {
  allow: boolean;
  pattern: string;
  re: RegExp;
}

const esc = (s: string): string => s.replace(/[.+?^${}()|[\]\\]/g, '\\$&');

function compile(pattern: string): RegExp {
  const end = pattern.endsWith('$');
  const body = (end ? pattern.slice(0, -1) : pattern).split('*').map(esc).join('.*');
  return new RegExp(`^${body}${end ? '$' : ''}`);
}

interface Group {
  agents: string[];
  rules: Rule[];
  crawlDelay: number | null;
}

export function parseRobots(text: string, agent: string = ROBOTS_AGENT): RobotsRules {
  const sitemaps: string[] = [];
  const groups: Group[] = [];
  let cur: Group | null = null;
  let inAgents = false;

  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/#.*$/, '').trim();
    const m = /^([A-Za-z-]+)\s*:\s*(.*)$/.exec(line);
    if (!m) continue;
    const key = m[1]!.toLowerCase();
    const val = m[2]!.trim();
    if (key === 'sitemap') {
      if (val) sitemaps.push(val);
    } else if (key === 'user-agent') {
      if (!inAgents || !cur) {
        cur = { agents: [], rules: [], crawlDelay: null };
        groups.push(cur);
      }
      cur.agents.push(val.toLowerCase());
      inAgents = true;
    } else {
      inAgents = false;
      if (!cur) continue;
      if (key === 'disallow' || key === 'allow') {
        if (key === 'disallow' && val === '') continue; // empty Disallow allows everything
        cur.rules.push({ allow: key === 'allow', pattern: val, re: compile(val) });
      } else if (key === 'crawl-delay') {
        const n = Number(val);
        if (Number.isFinite(n) && n >= 0) cur.crawlDelay = Math.round(n * 1000);
      }
    }
  }

  // Crawl-delay may sit outside a group in sloppy files; attach to the matching group only (strict), else ignore.
  const named = groups.filter((g) => g.agents.some((a) => a !== '*' && agent.includes(a) && a.length > 0));
  const star = groups.filter((g) => g.agents.includes('*'));
  const chosen = named.length ? named : star;
  const rules = chosen.flatMap((g) => g.rules);
  const delays = chosen.map((g) => g.crawlDelay).filter((d): d is number => d !== null);

  return {
    sitemaps,
    crawlDelayMs: delays.length ? Math.max(...delays) : null,
    isAllowed(path: string): boolean {
      let best: Rule | null = null;
      for (const r of rules) {
        if (!r.re.test(path)) continue;
        if (!best || r.pattern.length > best.pattern.length || (r.pattern.length === best.pattern.length && r.allow && !best.allow)) best = r;
      }
      return best ? best.allow : true;
    },
  };
}
