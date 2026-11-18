/* =====================================================================
   Ionic · Angular · Capacitor — Quick reference
   Vanilla JS, no build, no CDN. Works from file:// and behind Nginx.

   File layout:
     1. Storage + theme (runs before first paint)
     2. Utilities (escape, normalize, inline markup, code dedent)
     3. Syntax highlighter (ts, html, scss/css, json, bash, xml/plist, kotlin, java, swift, gradle, nginx)
     4. Renderers (blocks, topics, pages)
     5. Router, sidebar, search, favorites, events
     6. DATA  ← content lives here (sections → topics → blocks)
   ===================================================================== */
'use strict';

/* ---------------------------------------------------------------------
   1. Storage + theme
   --------------------------------------------------------------------- */
const Store = {
  get(key, fallback) {
    try {
      const raw = window.localStorage.getItem('iac:' + key);
      return raw === null ? fallback : JSON.parse(raw);
    } catch (e) {
      return fallback;
    }
  },
  set(key, value) {
    try {
      window.localStorage.setItem('iac:' + key, JSON.stringify(value));
    } catch (e) {
      /* storage unavailable (private mode, blocked cookies, file:// restrictions) */
    }
  },
};

const Theme = {
  media: window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null,
  current() {
    return document.documentElement.getAttribute('data-theme') || 'light';
  },
  apply(theme) {
    document.documentElement.setAttribute('data-theme', theme);
  },
  init() {
    const saved = Store.get('theme', null);
    this.apply(saved || (this.media && this.media.matches ? 'dark' : 'light'));
    if (this.media && this.media.addEventListener) {
      this.media.addEventListener('change', (e) => {
        if (!Store.get('theme', null)) this.apply(e.matches ? 'dark' : 'light');
      });
    }
  },
  toggle() {
    const next = this.current() === 'dark' ? 'light' : 'dark';
    this.apply(next);
    Store.set('theme', next);
  },
};
Theme.init();

/* ---------------------------------------------------------------------
   2. Utilities
   --------------------------------------------------------------------- */
const ESC_MAP = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => ESC_MAP[c]);
}

/** Lowercase + strip diacritics (accent-insensitive search). Keeps length for NFC input. */
function norm(s) {
  return String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

function dedent(s) {
  s = s.replace(/^\r?\n/, '').replace(/\s+$/, '');
  const lines = s.split(/\r?\n/);
  const widths = lines.filter((l) => l.trim()).map((l) => l.match(/^ */)[0].length);
  const indent = widths.length ? Math.min.apply(null, widths) : 0;
  return lines.map((l) => l.slice(indent)).join('\n');
}

/** Tag for code samples: raw string (no escape processing) + dedent. Use \` and \${ for literal ` and ${. */
function code(strings, ...values) {
  return dedent(String.raw(strings, ...values).replace(/\\`/g, '`').replace(/\\\$\{/g, '${'));
}

/** Mini inline markup: `code`, **bold**, [label](url), "⚠ verificar" badge. */
function inline(text) {
  return String(text == null ? '' : text)
    .split(/(`[^`]*`)/g)
    .map((part) => {
      if (part.length > 1 && part[0] === '`' && part[part.length - 1] === '`') {
        return '<code>' + esc(part.slice(1, -1)) + '</code>';
      }
      let h = esc(part);
      h = h.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
      h = h.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (m, label, url) => {
        const external = /^https?:/i.test(url);
        return '<a href="' + url + '"' + (external ? ' target="_blank" rel="noopener noreferrer"' : '') + '>' + label + '</a>';
      });
      h = h.replace(/⚠\s*verificar/g, '<span class="verify" title="Confirmar en la documentación oficial">⚠ verificar</span>');
      return h;
    })
    .join('');
}

function plainText(text) {
  return String(text == null ? '' : text)
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/[`*]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/* ---------------------------------------------------------------------
   3. Syntax highlighter (hand-written, rule-based tokenizer)
   --------------------------------------------------------------------- */
const Highlight = (() => {
  const span = (cls, text) => '<span class="tk-' + cls + '">' + esc(text) + '</span>';
  const raw = (m) => esc(m[0]);
  const sticky = (re) => new RegExp(re.source, re.flags.replace(/[gy]/g, '') + 'y');
  const prepare = (rules) => rules.filter(Boolean).map((r) => ({ re: sticky(r.re), cls: r.cls, when: r.when }));
  const afterBoundary = (src, i) => i === 0 || /[\s(=]/.test(src[i - 1]);
  const atLineStart = (src, i) => {
    let j = i - 1;
    while (j >= 0 && (src[j] === ' ' || src[j] === '\t')) j--;
    return j < 0 || src[j] === '\n';
  };

  function tokenize(src, rules) {
    let out = '';
    let plain = '';
    let i = 0;
    const n = src.length;
    while (i < n) {
      let matched = false;
      for (let r = 0; r < rules.length; r++) {
        const rule = rules[r];
        if (rule.when && !rule.when(src, i)) continue;
        rule.re.lastIndex = i;
        const m = rule.re.exec(src);
        if (m && m[0].length) {
          if (plain) {
            out += esc(plain);
            plain = '';
          }
          out += typeof rule.cls === 'function' ? rule.cls(m, src, i) : span(rule.cls, m[0]);
          i += m[0].length;
          matched = true;
          break;
        }
      }
      if (!matched) plain += src[i++];
    }
    if (plain) out += esc(plain);
    return out;
  }

  /* C-like languages: TypeScript, Kotlin, Java, Swift, Groovy */
  function clike(opts) {
    const kw = new Set(opts.keywords.split(/\s+/));
    const lits = new Set((opts.literals || 'true false null').split(/\s+/));
    const types = new Set((opts.types || '').split(/\s+/).filter(Boolean));
    const word = (m, src, i) => {
      const w = m[0];
      const next = src.substr(i + w.length, 30);
      const isCall = /^\s*(?:<[\w\s,<>[\]|.]*>)?\s*\(/.test(next);
      if (src[i - 1] === '.') return isCall ? span('function', w) : esc(w);
      if (kw.has(w)) return span('keyword', w);
      if (lits.has(w)) return span('bool', w);
      if (types.has(w)) return span('type', w);
      if (isCall) return span('function', w);
      if (/^[A-Z]/.test(w)) return span('type', w);
      return esc(w);
    };
    return prepare([
      { re: /\s+/, cls: raw },
      { re: /\/\*[\s\S]*?(?:\*\/|$)/, cls: 'comment' },
      { re: /\/\/.*/, cls: 'comment' },
      opts.tripleStr && { re: /"""[\s\S]*?(?:"""|$)/, cls: 'string' },
      opts.template && { re: /`(?:\\[\s\S]|[^\\`])*`?/, cls: 'string' },
      { re: /"(?:\\.|[^\\"\n])*"?/, cls: 'string' },
      { re: /'(?:\\.|[^\\'\n])*'?/, cls: 'string' },
      opts.decorators && { re: /@[A-Za-z_][\w.]*/, cls: 'decorator' },
      { re: /(?:0[xX][\da-fA-F_]+|\d[\d_]*(?:\.\d+)?(?:[eE][+-]?\d+)?)[a-zA-Z]*/, cls: 'number' },
      { re: /[A-Za-z_$][\w$]*/, cls: word },
      { re: /=>|->|[{}()[\];,.:?<>=!+\-*/%&|^~]/, cls: 'punct' },
    ]);
  }

  /* HTML (with Angular syntax) and XML (Android, plist) */
  function markup(angular) {
    const attrRe = /(\s+)([^\s"'>/=]+)(?:(\s*=\s*)("[^"]*"|'[^']*'|[^\s"'=<>`]+))?/y;
    const tag = (m) => {
      const t = m[0];
      const head = t.match(/^(<\/?)([\w:.-]+)/);
      const end = t.match(/\s*\/?>$/);
      let out = span('punct', head[1]) + span('tag', head[2]);
      const body = t.slice(head[0].length, t.length - end[0].length);
      let j = 0;
      while (j < body.length) {
        attrRe.lastIndex = j;
        const a = attrRe.exec(body);
        if (!a) {
          out += esc(body.slice(j));
          break;
        }
        const isBinding = angular && /^[[(*#@]|^(?:bind|on)-/.test(a[2]);
        out += esc(a[1]) + span(isBinding ? 'binding' : 'attr', a[2]);
        if (a[3]) out += span('punct', a[3]) + span('string', a[4]);
        j += a[0].length;
      }
      return out + span('punct', end[0]);
    };
    return prepare([
      { re: /\s+/, cls: raw },
      { re: /<!--[\s\S]*?(?:-->|$)/, cls: 'comment' },
      { re: /<!\[CDATA\[[\s\S]*?(?:\]\]>|$)/, cls: 'string' },
      { re: /<[?!][\s\S]*?>/, cls: 'keyword' },
      { re: /<\/?[A-Za-z][\w:.-]*(?:\s+[^\s"'>/=]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s"'=<>`]+))?)*\s*\/?>/, cls: tag },
      angular && { re: /\{\{[\s\S]*?\}\}/, cls: 'binding' },
      angular && { re: /@(?:if|else if|else|for|switch|case|default|defer|empty|placeholder|loading|error|let)\b/, cls: 'keyword' },
      { re: /&[#\w]+;/, cls: 'number' },
      { re: /[^<&{@\s]+/, cls: raw },
    ]);
  }

  /* CSS / SCSS */
  function css(scss) {
    return prepare([
      { re: /\s+/, cls: raw },
      { re: /\/\*[\s\S]*?(?:\*\/|$)/, cls: 'comment' },
      scss && { re: /\/\/.*/, cls: 'comment', when: (src, i) => src[i - 1] !== ':' },
      { re: /"(?:\\.|[^\\"\n])*"?|'(?:\\.|[^\\'\n])*'?/, cls: 'string' },
      { re: /\$[\w-]+/, cls: 'variable' },
      { re: /--[\w-]+/, cls: 'variable' },
      { re: /#\{[^}]*\}/, cls: 'variable' },
      { re: /@[\w-]+/, cls: 'keyword' },
      { re: /!(?:important|default)/, cls: 'keyword' },
      { re: /#[\da-fA-F]{3,8}\b/, cls: 'number' },
      { re: /[A-Za-z-][\w-]*(?=\s*:(?!:)[^;{}]*[;}])/, cls: 'property' },
      { re: /::?[A-Za-z-][\w-]*/, cls: 'builtin' },
      { re: /-?(?:\d+\.?\d*|\.\d+)(?:px|rem|em|%|vh|vw|dvh|svh|vmin|vmax|ms|s|deg|fr)?/, cls: 'number' },
      { re: /[A-Za-z_][\w-]*(?=\()/, cls: 'function' },
      { re: /[A-Za-z_][\w-]*/, cls: raw },
      { re: /[{}();:,>+~*&]/, cls: 'punct' },
    ]);
  }

  const json = prepare([
    { re: /\s+/, cls: raw },
    { re: /\/\/.*/, cls: 'comment' },
    { re: /"(?:\\.|[^\\"])*"(?=\s*:)/, cls: 'property' },
    { re: /"(?:\\.|[^\\"])*"?/, cls: 'string' },
    { re: /-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/, cls: 'number' },
    { re: /\b(?:true|false|null)\b/, cls: 'bool' },
    { re: /[{}[\],:]/, cls: 'punct' },
  ]);

  const SHELL_CMDS = new Set(
    ('npm npx ionic ng git cd ls dir mkdir cp mv rm echo export set unset cat adb keytool java javac gradlew ' +
      'sudo xcrun xcodebuild pod curl wget brew node nvm nginx sdkmanager avdmanager emulator open code grep ' +
      'chmod source bundle fastlane jarsigner bundletool apksigner zipalign where which systemctl ' +
      'New-NetFirewallRule Get-NetFirewallRule Remove-NetFirewallRule Set-Location Get-ChildItem').split(' ')
  );
  const bash = prepare([
    { re: /\s+/, cls: raw },
    { re: /#.*/, cls: 'comment', when: afterBoundary },
    { re: /"(?:\\.|[^\\"])*"?/, cls: 'string' },
    { re: /'[^']*'?/, cls: 'string' },
    { re: /\$\{[^}]*\}|\$(?:env:)?[\w@#?*!]+/, cls: 'variable' },
    { re: /--?[A-Za-z][\w-]*(?:=[^\s]*)?/, cls: 'attr', when: afterBoundary },
    { re: /\.{1,2}[\\/][\w./\\-]+/, cls: 'function' },
    { re: /\d[\d.]*(?::\d+)?\b/, cls: 'number', when: afterBoundary },
    {
      re: /[A-Za-z_][\w.:-]*/,
      cls: (m) => (SHELL_CMDS.has(m[0]) ? span('builtin', m[0]) : esc(m[0])),
    },
    { re: /&&|\|\||[|;<>]/, cls: 'punct' },
  ]);

  const conf = prepare([
    { re: /\s+/, cls: raw },
    { re: /#.*/, cls: 'comment', when: afterBoundary },
    { re: /"(?:\\.|[^\\"])*"?|'[^']*'?/, cls: 'string' },
    { re: /\$\w+/, cls: 'variable' },
    { re: /[A-Za-z_][\w.-]*/, cls: 'property', when: atLineStart },
    { re: /\b\d+[kmgsdhKMG]?\b/, cls: 'number' },
    { re: /[A-Za-z_][\w.-]*/, cls: raw },
    { re: /[{};=]/, cls: 'punct' },
  ]);

  const ts = clike({
    template: true,
    decorators: true,
    keywords:
      'abstract as async await break case catch class const constructor continue debugger declare default delete do else enum ' +
      'export extends finally for from function get if implements import in infer instanceof interface is keyof let module ' +
      'namespace new of override package private protected public readonly return satisfies set static super switch this throw ' +
      'try type typeof var void while with yield',
    literals: 'true false null undefined NaN Infinity',
    types: 'string number boolean any unknown never object symbol bigint',
  });
  const kotlin = clike({
    decorators: true,
    tripleStr: true,
    keywords:
      'package import class interface object fun val var if else when for while do return break continue try catch finally ' +
      'throw is in as this super override open abstract private public protected internal companion data sealed enum init ' +
      'constructor lateinit suspend vararg typealias by annotation inner',
  });
  const java = clike({
    decorators: true,
    keywords:
      'package import class interface enum extends implements public private protected static final abstract void new return ' +
      'if else for while do switch case default break continue try catch finally throw throws this super instanceof ' +
      'synchronized volatile transient native int long short byte char boolean float double var record',
  });
  const swift = clike({
    decorators: true,
    tripleStr: true,
    literals: 'true false nil',
    keywords:
      'import class struct enum protocol extension func var let if else guard switch case default for in while repeat return ' +
      'break continue throw throws rethrows try catch do self Self super init deinit public private fileprivate internal open ' +
      'static final override mutating weak unowned lazy as is async await some any where typealias inout defer',
  });
  const groovy = clike({
    keywords: 'def if else for while return new in as import class apply plugin task',
  });
  const csharp = clike({
    decorators: false,
    keywords:
      'using namespace class interface record struct enum public private protected internal static readonly const void new ' +
      'return if else for foreach in while do switch case default break continue try catch finally throw async await var ' +
      'this base override virtual abstract sealed partial get set init where is as out ref params string int long bool ' +
      'decimal double object dynamic',
  });

  const LANGS = {
    ts, typescript: ts, js: ts, javascript: ts,
    html: markup(true), xml: markup(false), plist: markup(false),
    scss: css(true), css: css(false),
    json,
    bash, sh: bash, shell: bash, powershell: bash,
    kotlin, java, swift, groovy, gradle: groovy, csharp, cs: csharp,
    nginx: conf, properties: conf, conf,
  };
  const LABELS = {
    ts: 'TypeScript', typescript: 'TypeScript', js: 'JavaScript', javascript: 'JavaScript',
    html: 'HTML', xml: 'XML', plist: 'plist', scss: 'SCSS', css: 'CSS', json: 'JSON',
    bash: 'Shell', sh: 'Shell', shell: 'Shell', powershell: 'PowerShell',
    kotlin: 'Kotlin', java: 'Java', swift: 'Swift', groovy: 'Gradle', gradle: 'Gradle', csharp: 'C#', cs: 'C#',
    nginx: 'Nginx', properties: 'Properties', conf: 'Config', text: 'Texto',
  };

  return {
    highlight(src, lang) {
      const rules = LANGS[lang];
      return rules ? tokenize(src, rules) : esc(src);
    },
    label(lang) {
      return LABELS[lang] || lang;
    },
  };
})();

/* ---------------------------------------------------------------------
   4. Renderers
   --------------------------------------------------------------------- */
const ICONS = {
  copy: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h10"/></svg>',
  check: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m5 12 5 5L20 7"/></svg>',
  link: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M10 14a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-1 1"/><path d="M14 10a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l1-1"/></svg>',
  caret: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m9 6 6 6-6 6"/></svg>',
  home: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 11 12 4l9 7"/><path d="M5 10v10h14V10"/></svg>',
  star: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m12 3 2.8 5.7 6.2.9-4.5 4.4 1 6.2L12 17.3 6.5 20.2l1-6.2L3 9.6l6.2-.9z"/></svg>',
};
const NOTE_ICONS = { info: 'ℹ', warn: '⚠', danger: '⛔', ok: '✓' };

let tabSeq = 0;

function renderCode(b) {
  const lang = b.lang || 'text';
  return (
    '<div class="code-block">' +
    '<div class="code-head">' +
    (b.file ? '<span class="code-file">' + esc(b.file) + '</span>' : '<span class="code-lang">' + esc(Highlight.label(lang)) + '</span>') +
    (b.file ? '<span class="code-lang">· ' + esc(Highlight.label(lang)) + '</span>' : '') +
    '<button class="copy-btn" type="button" data-copy aria-label="Copiar código">' + ICONS.copy + '<span>Copiar</span></button>' +
    '</div>' +
    '<pre class="code"><code>' + Highlight.highlight(b.code || '', lang) + '</code></pre>' +
    '</div>'
  );
}

function renderTabs(b) {
  const labels = b.tabs.map((t) => t.label);
  const group = labels.join('|');
  // Most recently chosen label that exists in this group wins (syncs Standalone/Legacy, Android/iOS… across groups)
  const recent = tabPrefs();
  let sel = 0;
  for (let i = 0; i < recent.length; i++) {
    const idx = labels.indexOf(recent[i]);
    if (idx >= 0) {
      sel = idx;
      break;
    }
  }
  const id = 'tb' + ++tabSeq;
  let head = '';
  let body = '';
  b.tabs.forEach((t, i) => {
    const on = i === sel;
    head +=
      '<button class="tab-btn" type="button" role="tab" id="' + id + '-t' + i + '" aria-controls="' + id + '-p' + i +
      '" aria-selected="' + on + '" tabindex="' + (on ? 0 : -1) + '" data-label="' + esc(t.label) + '">' + esc(t.label) + '</button>';
    body +=
      '<div class="tab-panel' + (t.blocks ? '' : ' code-only') + '" role="tabpanel" id="' + id + '-p' + i + '" aria-labelledby="' + id + '-t' + i + '"' +
      (on ? '' : ' hidden') + '>' + (t.blocks ? renderBlocks(t.blocks) : renderCode(t)) + '</div>';
  });
  return (
    (b.title ? '<div class="block-title">' + inline(b.title) + '</div>' : '') +
    '<div class="tabs" data-group="' + esc(group) + '"><div class="tab-list" role="tablist">' + head + '</div><div class="tabs-content">' + body + '</div></div>'
  );
}

function renderTable(b) {
  return (
    (b.title ? '<div class="block-title">' + inline(b.title) + '</div>' : '') +
    '<div class="table-wrap"><table><thead><tr>' +
    b.head.map((h) => '<th>' + inline(h) + '</th>').join('') +
    '</tr></thead><tbody>' +
    b.rows.map((r) => '<tr>' + r.map((c) => '<td>' + inline(c) + '</td>').join('') + '</tr>').join('') +
    '</tbody></table></div>'
  );
}

function renderBlock(b) {
  switch (b.t) {
    case 'p':
      return '<p>' + inline(b.text) + '</p>';
    case 'h':
      return '<div class="block-title">' + inline(b.text) + '</div>';
    case 'list': {
      const tag = b.ordered ? 'ol' : 'ul';
      return (b.title ? '<div class="block-title">' + inline(b.title) + '</div>' : '') +
        '<' + tag + '>' + b.items.map((i) => '<li>' + inline(i) + '</li>').join('') + '</' + tag + '>';
    }
    case 'note': {
      const kind = b.kind || 'info';
      return '<div class="note ' + kind + '"><span class="note-icon" aria-hidden="true">' + NOTE_ICONS[kind] + '</span><div><p>' + inline(b.text) + '</p></div></div>';
    }
    case 'code':
      return (b.title ? '<div class="block-title">' + inline(b.title) + '</div>' : '') + renderCode(b);
    case 'tabs':
      return renderTabs(b);
    case 'table':
      return renderTable(b);
    default:
      console.warn('[docs] Unknown block type:', b.t);
      return '';
  }
}

function renderBlocks(blocks) {
  return (blocks || []).map(renderBlock).join('');
}

const topicDomId = (secId, topicId) => secId + '--' + topicId;
const topicKey = (secId, topicId) => secId + '/' + topicId;

function renderTopic(sec, t) {
  const key = topicKey(sec.id, t.id);
  const fav = Favs.has(key);
  let h = '<article class="topic" id="' + topicDomId(sec.id, t.id) + '" data-key="' + esc(key) + '">';
  h += '<div class="topic-head"><h2>' + inline(t.title) + '<a class="anchor" href="#/' + key + '" aria-label="Enlace a este tema">#</a></h2>';
  h += '<button class="link-btn" type="button" data-copy-link="' + esc(key) + '" title="Copiar enlace" aria-label="Copiar enlace al tema">' + ICONS.link + '</button>';
  h += '<button class="star-btn' + (fav ? ' on' : '') + '" type="button" data-fav="' + esc(key) + '" aria-pressed="' + fav + '" title="Favorito" aria-label="Marcar como favorito">' + (fav ? '★' : '☆') + '</button></div>';
  if (t.tags && t.tags.length) h += '<div class="tags">' + t.tags.map((g) => '<span class="tag">' + esc(g) + '</span>').join('') + '</div>';
  if (t.summary) h += '<p class="summary">' + inline(t.summary) + '</p>';
  if (t.when && t.when.length) h += '<h3>Cuándo usarlo</h3><ul class="when-list">' + t.when.map((w) => '<li>' + inline(w) + '</li>').join('') + '</ul>';
  if (t.blocks && t.blocks.length) h += '<h3>Ejemplo y referencia</h3>' + renderBlocks(t.blocks);
  if (t.pitfalls && t.pitfalls.length) h += '<h3>Errores comunes</h3><ul class="pitfalls">' + t.pitfalls.map((p) => '<li>' + inline(p) + '</li>').join('') + '</ul>';
  if (t.links && t.links.length) {
    h += '<h3>Documentación oficial</h3><div class="official">' +
      t.links.map((l) => '<a href="' + esc(l[1]) + '" target="_blank" rel="noopener noreferrer">' + esc(l[0]) + '</a>').join('') + '</div>';
  }
  return h + '</article>';
}

/* ---------------------------------------------------------------------
   5. App: router, sidebar, search, favorites, events
   --------------------------------------------------------------------- */
const $ = (sel, root) => (root || document).querySelector(sel);
const $$ = (sel, root) => Array.prototype.slice.call((root || document).querySelectorAll(sel));

const Favs = {
  list: [],
  load() {
    const v = Store.get('favs', []);
    this.list = Array.isArray(v) ? v.filter((k) => typeof k === 'string') : [];
  },
  has(key) {
    return this.list.indexOf(key) >= 0;
  },
  toggle(key) {
    if (this.has(key)) this.list = this.list.filter((k) => k !== key);
    else this.list.push(key);
    Store.set('favs', this.list);
    return this.has(key);
  },
  resolved() {
    return this.list.map(findTopicByKey).filter(Boolean);
  },
};

function findSection(id) {
  for (let i = 0; i < DOCS.length; i++) if (DOCS[i].id === id) return DOCS[i];
  return null;
}
function findTopicByKey(key) {
  const parts = String(key).split('/');
  const sec = findSection(parts[0]);
  if (!sec) return null;
  for (let i = 0; i < sec.topics.length; i++) if (sec.topics[i].id === parts[1]) return { sec, topic: sec.topics[i] };
  return null;
}

const App = {
  route: null,
  renderedView: null,
  openSections: new Set(),
  observer: null,
};

const isMobile = () => window.matchMedia('(max-width: 900px)').matches;

function toast(msg) {
  const el = $('#toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => el.classList.remove('show'), 1600);
}

function copyText(text) {
  const fallback = () =>
    new Promise((resolve, reject) => {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.setAttribute('readonly', '');
      ta.style.position = 'fixed';
      ta.style.top = '-1000px';
      document.body.appendChild(ta);
      ta.select();
      let ok = false;
      try {
        ok = document.execCommand('copy');
      } catch (e) {
        ok = false;
      }
      document.body.removeChild(ta);
      ok ? resolve() : reject(new Error('copy failed'));
    });
  if (navigator.clipboard && window.isSecureContext) return navigator.clipboard.writeText(text).catch(fallback);
  return fallback();
}

/* ----- Sidebar ----- */
function renderSidebar() {
  let h = '<div class="nav-quick">';
  h += '<a class="nav-link" href="#/" data-nav="home">' + ICONS.home + '<span>Inicio</span></a>';
  h += '<a class="nav-link" href="#/favoritos" data-nav="favoritos">' + ICONS.star + '<span>Favoritos</span><span class="nav-count" id="favCount">' + Favs.resolved().length + '</span></a>';
  h += '</div>';
  DOCS.forEach((sec) => {
    const open = App.openSections.has(sec.id);
    h += '<div class="nav-section' + (open ? ' open' : '') + '" data-sec="' + esc(sec.id) + '">';
    h += '<div class="nav-section-head"><a class="nav-link" href="#/' + esc(sec.id) + '" data-nav="' + esc(sec.id) + '"><span class="nav-num">' + sec.num + '</span><span>' + esc(sec.title) + '</span></a>';
    h += '<button class="nav-caret" type="button" data-toggle-sec="' + esc(sec.id) + '" aria-expanded="' + open + '" aria-label="Mostrar temas de ' + esc(sec.title) + '">' + ICONS.caret + '</button></div>';
    h += '<div class="nav-topics">' + sec.topics.map((t) => '<a class="nav-link" href="#/' + esc(topicKey(sec.id, t.id)) + '" data-topic="' + esc(topicKey(sec.id, t.id)) + '">' + esc(plainText(t.title)) + '</a>').join('') + '</div>';
    h += '</div>';
  });
  $('#sidebarNav').innerHTML = h;
}

function updateSidebarActive(view) {
  $$('#sidebarNav [data-nav]').forEach((a) => {
    const on = a.getAttribute('data-nav') === view;
    a.classList.toggle('active', on);
    if (on) a.setAttribute('aria-current', 'page');
    else a.removeAttribute('aria-current');
  });
  const secEl = $('#sidebarNav .nav-section[data-sec="' + view + '"]');
  if (secEl && !secEl.classList.contains('open')) toggleSection(view, true);
  if (secEl) {
    const r = secEl.getBoundingClientRect();
    const box = $('#sidebar').getBoundingClientRect();
    if (r.top < box.top || r.top > box.bottom - 60) secEl.scrollIntoView({ block: 'nearest' });
  }
}

function toggleSection(id, force) {
  const el = $('#sidebarNav .nav-section[data-sec="' + id + '"]');
  if (!el) return;
  const open = typeof force === 'boolean' ? force : !el.classList.contains('open');
  el.classList.toggle('open', open);
  const btn = $('[data-toggle-sec]', el);
  if (btn) btn.setAttribute('aria-expanded', String(open));
  if (open) App.openSections.add(id);
  else App.openSections.delete(id);
}

function setCurrentTopic(key) {
  $$('#sidebarNav .nav-topics .nav-link.current').forEach((a) => a.classList.remove('current'));
  if (!key) return;
  const a = $('#sidebarNav [data-topic="' + key + '"]');
  if (a) a.classList.add('current');
}

function setSidebar(open) {
  const body = document.body;
  if (isMobile()) {
    body.classList.toggle('sidebar-open', open);
    $('#backdrop').hidden = !open;
  } else {
    body.classList.toggle('sidebar-collapsed', !open);
    Store.set('sidebarCollapsed', !open);
  }
  $('#sidebarToggle').setAttribute('aria-expanded', String(open));
}
function sidebarIsOpen() {
  return isMobile() ? document.body.classList.contains('sidebar-open') : !document.body.classList.contains('sidebar-collapsed');
}

/* ----- Views ----- */
function renderHome() {
  const favs = Favs.resolved();
  let h = '<section class="hero"><h1>Ionic · Angular · Capacitor</h1>';
  h += '<p>Manual de consulta rápida: componentes, plugins, patrones móviles y ejemplos listos para copiar. Enfoque <strong>standalone</strong> (<code>@ionic/angular/standalone</code>); <code>IonicModule</code> aparece solo como legacy.</p>';
  h += '<div class="hero-hints"><span><kbd>Ctrl</kbd> + <kbd>K</kbd> o <kbd>/</kbd> para buscar</span><span>☆ marca favoritos</span><span>Las pestañas recuerdan tu elección</span><span>Capacitor 8 · Ionic y Angular: últimas estables</span></div></section>';
  if (favs.length) {
    h += '<h2 class="h-section">★ Favoritos</h2>' + renderFavList(favs);
  }
  h += '<h2 class="h-section">Secciones</h2><div class="grid">';
  DOCS.forEach((sec) => {
    h += '<a class="card" href="#/' + esc(sec.id) + '"><span class="card-num">Sección ' + sec.num + '</span><span class="card-title">' + esc(sec.title) + '</span><span class="card-desc">' + inline(sec.desc) + '</span><span class="card-meta">' + sec.topics.length + ' temas</span></a>';
  });
  h += '</div>';
  return h;
}

function renderFavList(favs) {
  return '<ul class="fav-list">' + favs.map((f) =>
    '<li><a href="#/' + esc(topicKey(f.sec.id, f.topic.id)) + '"><span class="fav-star">★</span><span>' + esc(plainText(f.topic.title)) + '</span><span class="fav-sec">' + esc(f.sec.title) + '</span></a></li>'
  ).join('') + '</ul>';
}

function renderFavorites() {
  const favs = Favs.resolved();
  let h = '<header class="page-head"><div class="crumbs">Tus temas guardados</div><h1>★ Favoritos</h1><p>Se guardan en este navegador (<code>localStorage</code>).</p></header>';
  h += favs.length ? renderFavList(favs) : '<div class="empty">Aún no tienes favoritos. Pulsa ☆ en cualquier tema para guardarlo aquí.</div>';
  return h;
}

function renderSection(sec) {
  const idx = DOCS.indexOf(sec);
  const prev = DOCS[idx - 1];
  const next = DOCS[idx + 1];
  let h = '<header class="page-head"><div class="crumbs">Sección ' + sec.num + ' de ' + DOCS.length + '</div><h1>' + esc(sec.title) + '</h1><p>' + inline(sec.desc) + '</p>';
  h += '<nav class="toc" aria-label="Temas de la sección">' + sec.topics.map((t) => '<a href="#/' + esc(topicKey(sec.id, t.id)) + '">' + esc(plainText(t.title)) + '</a>').join('') + '</nav></header>';
  h += sec.topics.map((t) => renderTopic(sec, t)).join('');
  h += '<nav class="pager" aria-label="Paginación">';
  if (prev) h += '<a class="prev" href="#/' + esc(prev.id) + '"><small>← Anterior</small>' + esc(prev.title) + '</a>';
  if (next) h += '<a class="next" href="#/' + esc(next.id) + '"><small>Siguiente →</small>' + esc(next.title) + '</a>';
  h += '</nav>';
  return h;
}

function renderNotFound(what) {
  return '<header class="page-head"><h1>No encontrado</h1><p>No existe <code>' + esc(what) + '</code>. <a href="#/">Volver al inicio</a> o usa el buscador (<kbd>Ctrl</kbd>+<kbd>K</kbd>).</p></header>';
}

function setView(viewId, html) {
  const main = $('#main');
  tabSeq = 0;
  main.innerHTML = html;
  App.renderedView = viewId;
  observeTopics();
}

function observeTopics() {
  if (App.observer) App.observer.disconnect();
  setCurrentTopic(null);
  if (!('IntersectionObserver' in window)) return;
  const visible = new Map();
  App.observer = new IntersectionObserver(
    (entries) => {
      entries.forEach((e) => {
        if (e.isIntersecting) visible.set(e.target, e.boundingClientRect.top);
        else visible.delete(e.target);
      });
      let best = null;
      let bestTop = Infinity;
      visible.forEach((top, el) => {
        const t = el.getBoundingClientRect().top;
        if (t < bestTop) {
          bestTop = t;
          best = el;
        }
      });
      if (best) setCurrentTopic(best.getAttribute('data-key'));
    },
    { rootMargin: '-64px 0px -55% 0px', threshold: 0 }
  );
  $$('#main .topic').forEach((el) => App.observer.observe(el));
}

/* ----- Router (#/section/topic) ----- */
function parseHash() {
  let h = location.hash || '';
  try {
    h = decodeURIComponent(h);
  } catch (e) {
    /* keep raw */
  }
  if (h === '' || h === '#') return { sec: '', topic: '' };
  if (h.indexOf('#/') !== 0) return null;
  const parts = h.slice(2).split('/');
  return { sec: parts[0] || '', topic: parts[1] || '' };
}

function onRoute() {
  let r = parseHash();
  if (!r) {
    if (App.renderedView) return; // plain in-page anchor, keep current view
    r = { sec: '', topic: '' };
  }
  App.route = r;
  let view = r.sec || 'home';
  let fresh = false;

  if (view === 'home') {
    setView('home', renderHome());
    fresh = true;
    document.title = 'Ionic Docs — Referencia rápida';
  } else if (view === 'favoritos') {
    setView('favoritos', renderFavorites());
    fresh = true;
    document.title = 'Favoritos — Ionic Docs';
  } else {
    const sec = findSection(r.sec);
    if (!sec) {
      setView('404', renderNotFound('#/' + r.sec));
      fresh = true;
      view = '404';
    } else {
      if (App.renderedView !== sec.id) {
        setView(sec.id, renderSection(sec));
        fresh = true;
      }
      const topic = r.topic ? sec.topics.find((t) => t.id === r.topic) : null;
      document.title = (topic ? plainText(topic.title) + ' · ' : '') + sec.title + ' — Ionic Docs';
    }
  }

  updateSidebarActive(view);
  if (isMobile()) setSidebar(false);

  const target = r.topic ? document.getElementById(topicDomId(r.sec, r.topic)) : null;
  if (target) {
    // Wait a frame so layout is ready after a fresh render
    requestAnimationFrame(() => {
      target.scrollIntoView({ block: 'start' });
      target.classList.remove('flash');
      void target.offsetWidth;
      target.classList.add('flash');
      setCurrentTopic(topicKey(r.sec, r.topic));
    });
  } else if (r.topic && view !== '404') {
    toast('Tema no encontrado: ' + r.topic);
    if (fresh) window.scrollTo(0, 0);
  } else if (fresh) {
    window.scrollTo(0, 0);
  }
}

function navigate(href) {
  if (location.hash === href) onRoute();
  else location.hash = href;
}

/* ----- Search ----- */
const Search = {
  index: [],
  results: [],
  sel: 0,
  isOpen: false,
  lastFocus: null,

  build() {
    const collect = (blocks, acc) => {
      (blocks || []).forEach((b) => {
        if (b.text) acc.push(b.text);
        if (b.title) acc.push(b.title);
        if (b.items) acc.push(b.items.join(' '));
        if (b.head) acc.push(b.head.join(' '));
        if (b.rows) b.rows.forEach((r) => acc.push(r.join(' ')));
        if (b.code) acc.push(b.code);
        if (b.tabs) b.tabs.forEach((t) => {
          acc.push(t.label);
          if (t.code) acc.push(t.code);
          if (t.blocks) collect(t.blocks, acc);
        });
      });
      return acc;
    };
    this.index = [];
    DOCS.forEach((sec) => {
      sec.topics.forEach((t) => {
        const title = plainText(t.title);
        const summary = plainText(t.summary);
        const body = plainText(collect(t.blocks, [].concat(t.when || [], t.pitfalls || [])).join(' '));
        this.index.push({
          key: topicKey(sec.id, t.id),
          sec,
          title,
          summary,
          body,
          nTitle: norm(title),
          nTags: norm((t.tags || []).join(' ')),
          nSummary: norm(summary),
          nBody: norm(body),
          nSec: norm(sec.title),
          // Punctuation-free haystack: "aspnet" matches "ASP.NET", "10022" matches "10.0.2.2"
          cAll: norm([title, (t.tags || []).join(' '), summary, body, sec.title].join(' ')).replace(/[^a-z0-9]/g, ''),
        });
      });
    });
  },

  open() {
    if (this.isOpen) return;
    this.isOpen = true;
    this.lastFocus = document.activeElement;
    $('#searchModal').hidden = false;
    const input = $('#searchInput');
    input.value = '';
    this.run('');
    input.focus();
  },

  close() {
    if (!this.isOpen) return;
    this.isOpen = false;
    $('#searchModal').hidden = true;
    if (this.lastFocus && this.lastFocus.focus) this.lastFocus.focus({ preventScroll: true });
  },

  run(query) {
    const q = norm(query.trim());
    const tokens = q.split(/\s+/).filter(Boolean);
    if (!tokens.length) {
      const favKeys = Favs.list;
      this.results = this.index.filter((it) => favKeys.indexOf(it.key) >= 0).map((it) => ({ it, score: 1 }));
      this.render(tokens, true);
      return;
    }
    const out = [];
    this.index.forEach((it) => {
      let score = 0;
      for (let i = 0; i < tokens.length; i++) {
        const tk = tokens[i];
        const inTitle = it.nTitle.indexOf(tk) >= 0;
        const inTags = it.nTags.indexOf(tk) >= 0;
        const inSum = it.nSummary.indexOf(tk) >= 0;
        const inSec = it.nSec.indexOf(tk) >= 0;
        const inBody = it.nBody.indexOf(tk) >= 0;
        if (!inTitle && !inTags && !inSum && !inSec && !inBody) {
          const compact = tk.replace(/[^a-z0-9]/g, '');
          if (compact.length >= 3 && it.cAll.indexOf(compact) >= 0) {
            score += 1;
            continue;
          }
          return;
        }
        if (inTitle) score += it.nTitle.indexOf(tk) === 0 || it.nTitle.indexOf(' ' + tk) >= 0 ? 12 : 8;
        if (inTags) score += 6;
        if (inSec) score += 3;
        if (inSum) score += 3;
        if (inBody) score += 1;
      }
      if (tokens.length > 1 && it.nTitle.indexOf(q) >= 0) score += 10;
      out.push({ it, score });
    });
    out.sort((a, b) => b.score - a.score);
    this.results = out.slice(0, 40);
    this.render(tokens, false);
  },

  render(tokens, empty) {
    this.sel = 0;
    const ul = $('#searchResults');
    if (!this.results.length) {
      ul.innerHTML = '<li class="sr-empty">' + (empty ? 'Escribe para buscar en ' + this.index.length + ' temas. Tus favoritos aparecerán aquí.' : 'Sin resultados.') + '</li>';
      return;
    }
    ul.innerHTML = this.results.map((r, i) => {
      const it = r.it;
      const inSummary = tokens.some((tk) => it.nSummary.indexOf(tk) >= 0);
      const snip = empty || !tokens.length
        ? esc(it.summary.slice(0, 140))
        : inSummary || !tokens.some((tk) => it.nBody.indexOf(tk) >= 0)
          ? snippet(it.summary, it.nSummary, tokens)
          : snippet(it.body, it.nBody, tokens);
      return '<li role="option" id="sr' + i + '" class="' + (i === 0 ? 'sel' : '') + '" aria-selected="' + (i === 0) + '"><a href="#/' + esc(it.key) + '" data-sr="' + i + '">' +
        '<span class="sr-title">' + markTokens(it.title, it.nTitle, tokens) + '</span><span class="sr-sec">' + esc(it.sec.title) + '</span>' +
        '<span class="sr-snip">' + snip + '</span></a></li>';
    }).join('');
  },

  move(delta) {
    if (!this.results.length) return;
    const items = $$('#searchResults li[role="option"]');
    items[this.sel].classList.remove('sel');
    items[this.sel].setAttribute('aria-selected', 'false');
    this.sel = (this.sel + delta + items.length) % items.length;
    items[this.sel].classList.add('sel');
    items[this.sel].setAttribute('aria-selected', 'true');
    items[this.sel].scrollIntoView({ block: 'nearest' });
  },

  go(i) {
    const r = this.results[typeof i === 'number' ? i : this.sel];
    if (!r) return;
    this.close();
    navigate('#/' + r.it.key);
  },
};

function snippet(raw, normed, tokens) {
  let pos = -1;
  for (let i = 0; i < tokens.length && pos < 0; i++) pos = normed.indexOf(tokens[i]);
  if (pos < 0) pos = 0;
  const start = Math.max(0, pos - 40);
  const end = Math.min(raw.length, start + 150);
  return (start > 0 ? '…' : '') + markTokens(raw.slice(start, end), normed.slice(start, end), tokens) + (end < raw.length ? '…' : '');
}

function markTokens(raw, normed, tokens) {
  if (!tokens.length || raw.length !== normed.length) return esc(raw);
  const ranges = [];
  tokens.forEach((tk) => {
    let i = normed.indexOf(tk);
    while (i >= 0) {
      ranges.push([i, i + tk.length]);
      i = normed.indexOf(tk, i + tk.length);
    }
  });
  if (!ranges.length) return esc(raw);
  ranges.sort((a, b) => a[0] - b[0]);
  const merged = [ranges[0]];
  for (let i = 1; i < ranges.length; i++) {
    const last = merged[merged.length - 1];
    if (ranges[i][0] <= last[1]) last[1] = Math.max(last[1], ranges[i][1]);
    else merged.push(ranges[i]);
  }
  let out = '';
  let pos = 0;
  merged.forEach((r) => {
    out += esc(raw.slice(pos, r[0])) + '<mark>' + esc(raw.slice(r[0], r[1])) + '</mark>';
    pos = r[1];
  });
  return out + esc(raw.slice(pos));
}

/* ----- Tabs ----- */
function tabPrefs() {
  const v = Store.get('tabs', []);
  return Array.isArray(v) ? v.filter((x) => typeof x === 'string') : [];
}

/** Selects `label` in every tab group on the page that has it, and remembers it as most recent. */
function selectTab(label, save) {
  $$('.tabs').forEach((tabs) => {
    const btns = $$(':scope > .tab-list > .tab-btn', tabs);
    if (!btns.some((b) => b.getAttribute('data-label') === label)) return;
    const panels = $$(':scope > .tabs-content > .tab-panel', tabs);
    btns.forEach((b, i) => {
      const on = b.getAttribute('data-label') === label;
      b.setAttribute('aria-selected', String(on));
      b.tabIndex = on ? 0 : -1;
      panels[i].hidden = !on;
    });
  });
  if (save) {
    const recent = tabPrefs().filter((x) => x !== label);
    recent.unshift(label);
    Store.set('tabs', recent.slice(0, 30));
  }
}

/* ----- Dev check: internal links + duplicate ids (warnings only) ----- */
function validateData() {
  const ids = new Set();
  const problems = [];
  DOCS.forEach((s) => {
    if (ids.has(s.id)) problems.push('Sección duplicada: ' + s.id);
    ids.add(s.id);
    const seen = new Set();
    s.topics.forEach((t) => {
      if (seen.has(t.id)) problems.push('Tema duplicado: ' + s.id + '/' + t.id);
      seen.add(t.id);
      ids.add(s.id + '/' + t.id);
    });
  });
  const json = JSON.stringify(DOCS);
  const re = /\]\(#\/([^)]*)\)/g;
  let m;
  while ((m = re.exec(json))) {
    if (m[1] !== '' && m[1] !== 'favoritos' && !ids.has(m[1])) problems.push('Enlace interno roto: #/' + m[1]);
  }
  if (problems.length) console.warn('[docs] Problemas en los datos:\n  ' + problems.join('\n  '));
  return problems;
}

/* ----- Events ----- */
function bindEvents() {
  $('#themeToggle').addEventListener('click', () => Theme.toggle());
  $('#sidebarToggle').addEventListener('click', () => setSidebar(!sidebarIsOpen()));
  $('#backdrop').addEventListener('click', () => setSidebar(false));
  $('#searchOpen').addEventListener('click', () => Search.open());

  $('.skip-link').addEventListener('click', (e) => {
    e.preventDefault();
    $('#main').focus({ preventScroll: true });
  });

  const input = $('#searchInput');
  input.addEventListener('input', () => Search.run(input.value));
  input.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); Search.move(1); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); Search.move(-1); }
    else if (e.key === 'Enter') { e.preventDefault(); Search.go(); }
  });
  $('#searchModal').addEventListener('click', (e) => {
    if (e.target.id === 'searchModal') Search.close();
    const a = e.target.closest('[data-sr]');
    if (a) {
      e.preventDefault();
      Search.go(Number(a.getAttribute('data-sr')));
    }
  });

  document.addEventListener('keydown', (e) => {
    const typing = e.target.closest && e.target.closest('input, textarea, select, [contenteditable="true"]');
    if ((e.ctrlKey || e.metaKey) && !e.altKey && e.key.toLowerCase() === 'k') {
      e.preventDefault();
      Search.isOpen ? Search.close() : Search.open();
    } else if (e.key === '/' && !typing && !Search.isOpen && !e.ctrlKey && !e.metaKey) {
      e.preventDefault();
      Search.open();
    } else if (e.key === 'Escape') {
      if (Search.isOpen) Search.close();
      else if (isMobile() && sidebarIsOpen()) setSidebar(false);
    }
  });

  document.addEventListener('click', (e) => {
    const t = e.target;

    const tab = t.closest('.tab-btn');
    if (tab) {
      selectTab(tab.getAttribute('data-label'), true);
      return;
    }

    const copyBtn = t.closest('[data-copy]');
    if (copyBtn) {
      const pre = copyBtn.closest('.code-block').querySelector('pre');
      copyText(pre.textContent).then(
        () => {
          copyBtn.classList.add('done');
          copyBtn.innerHTML = ICONS.check + '<span>Copiado</span>';
          setTimeout(() => {
            copyBtn.classList.remove('done');
            copyBtn.innerHTML = ICONS.copy + '<span>Copiar</span>';
          }, 1500);
        },
        () => toast('No se pudo copiar')
      );
      return;
    }

    const favBtn = t.closest('[data-fav]');
    if (favBtn) {
      const key = favBtn.getAttribute('data-fav');
      const on = Favs.toggle(key);
      $$('[data-fav="' + key + '"]').forEach((b) => {
        b.classList.toggle('on', on);
        b.setAttribute('aria-pressed', String(on));
        b.textContent = on ? '★' : '☆';
      });
      $('#favCount').textContent = Favs.resolved().length;
      toast(on ? 'Añadido a favoritos' : 'Quitado de favoritos');
      return;
    }

    const linkBtn = t.closest('[data-copy-link]');
    if (linkBtn) {
      const url = location.href.split('#')[0] + '#/' + linkBtn.getAttribute('data-copy-link');
      copyText(url).then(() => toast('Enlace copiado'), () => toast(url));
      return;
    }

    const caret = t.closest('[data-toggle-sec]');
    if (caret) {
      toggleSection(caret.getAttribute('data-toggle-sec'));
      return;
    }

    // Same-hash link (e.g. clicking the current topic again): force scroll
    const a = t.closest('a[href^="#/"]');
    if (a && !e.ctrlKey && !e.metaKey && !e.shiftKey && a.getAttribute('href') === location.hash) {
      e.preventDefault();
      onRoute();
    }
  });

  // Arrow-key navigation inside tab lists
  document.addEventListener('keydown', (e) => {
    const tab = e.target.closest && e.target.closest('.tab-btn');
    if (!tab || (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft')) return;
    const btns = $$('.tab-btn', tab.parentNode);
    const i = btns.indexOf(tab);
    const next = btns[(i + (e.key === 'ArrowRight' ? 1 : -1) + btns.length) % btns.length];
    next.focus();
    next.click();
  });

  window.addEventListener('hashchange', onRoute);

  let wasMobile = isMobile();
  window.addEventListener('resize', () => {
    const m = isMobile();
    if (m !== wasMobile) {
      wasMobile = m;
      document.body.classList.remove('sidebar-open');
      $('#backdrop').hidden = true;
      $('#sidebarToggle').setAttribute('aria-expanded', String(sidebarIsOpen()));
    }
  });
}

function init() {
  Favs.load();
  if (Store.get('sidebarCollapsed', false)) document.body.classList.add('sidebar-collapsed');
  const r = parseHash();
  if (r && r.sec) App.openSections.add(r.sec);
  renderSidebar();
  $('#sidebarToggle').setAttribute('aria-expanded', String(sidebarIsOpen()));
  Search.build();
  bindEvents();
  onRoute();
  validateData();
}

document.addEventListener('DOMContentLoaded', init);

/* =====================================================================
   6. DATA
   Section: { id, num, title, desc, topics: Topic[] }
   Topic:   { id, title, tags[], summary, when[], blocks[], pitfalls[], links: [label, url][] }
   Blocks:
     { t:'p', text }                         paragraph (inline: `code`, **bold**, [txt](url), ⚠ verificar)
     { t:'h', text }                         small sub-heading
     { t:'list', items[], ordered?, title? }
     { t:'note', kind:'info'|'warn'|'danger'|'ok', text }
     { t:'code', lang, code, file?, title? } use the code`...` tag for samples
     { t:'tabs', title?, tabs:[{ label, lang, code, file? } | { label, blocks[] }] }
     { t:'table', head[], rows[][], title? }
   Internal links: [texto](#/section-id/topic-id)
   ===================================================================== */
const DOCS = [
  /* ===================================================================
     1. INICIO Y CLI
     =================================================================== */
  {
    id: 'inicio-cli',
    num: 1,
    title: 'Inicio y CLI',
    desc: "Crear proyectos, servir en navegador, generar código, estructura, `capacitor.config.ts`, comandos `npx cap` y live reload en dispositivo.",
    topics: [
      {
        id: 'ionic-start',
        title: 'Instalar el CLI y crear un proyecto (`ionic start`)',
        tags: ['ionic start', '@ionic/cli', 'plantillas', 'standalone'],
        summary: "El CLI de Ionic crea el proyecto desde una plantilla (Angular + Capacitor ya integrado) y envuelve a Angular CLI y Capacitor CLI.",
        when: [
          "Al empezar un proyecto nuevo o un prototipo con plantilla `tabs` / `sidemenu`.",
          "Para generar un proyecto limpio de referencia y comparar estructura con uno existente (muy útil tras una migración Cordova → Capacitor).",
        ],
        blocks: [
          {
            t: 'code',
            lang: 'bash',
            code: code`
              # Requirements: Node.js LTS + npm
              npm install -g @ionic/cli
              ionic --version

              # Interactive: asks framework, template and NgModules vs Standalone
              ionic start

              # Non-interactive: Angular + tabs template
              ionic start myApp tabs --type=angular

              # Show available templates
              ionic start --list

              # Without a global install
              npx @ionic/cli start myApp blank --type=angular
            `,
          },
          {
            t: 'table',
            title: 'Plantillas habituales (confirma con `ionic start --list`) ⚠ verificar',
            head: ['Plantilla', 'Qué trae'],
            rows: [
              ['`blank`', 'Una sola página `home`. Ideal para empezar limpio.'],
              ['`tabs`', '`ion-tabs` con 3 tabs y rutas hijas.'],
              ['`sidemenu`', '`ion-menu` + `ion-split-pane` (menú fijo en desktop).'],
              ['`list`', 'Lista con detalle (patrón maestro-detalle).'],
            ],
          },
          {
            t: 'note',
            kind: 'info',
            text: "Cuando el CLI pregunte **NgModules o Standalone**, elige **Standalone**: es el enfoque recomendado y el que usan todos los ejemplos de este manual. Para pasar la opción sin prompt revisa `ionic start --help` ⚠ verificar.",
          },
        ],
        pitfalls: [
          "Instalar el paquete antiguo `ionic` en lugar de `@ionic/cli`.",
          "Usar una versión de Node no soportada por la versión de Angular CLI → errores raros de instalación. Usa la LTS activa.",
          "Dejar el `appId` por defecto (`io.ionic.starter`). Cámbialo antes de añadir plataformas: después hay que tocarlo también en Gradle y Xcode.",
          "Nombres de carpeta con espacios o tildes: generan rutas y `appId` problemáticos.",
        ],
        links: [
          ['ionic start', 'https://ionicframework.com/docs/cli/commands/start'],
          ['Instalación del CLI', 'https://ionicframework.com/docs/intro/cli'],
        ],
      },
      {
        id: 'ionic-serve',
        title: '`ionic serve` y desarrollo en navegador',
        tags: ['ionic serve', 'ng serve', '8100', '--external', 'ionic:mode'],
        summary: "Levanta el dev server de Angular (envuelve `ng serve`) con recarga en caliente, por defecto en `http://localhost:8100`.",
        when: [
          "Desarrollo diario de UI y lógica con DevTools.",
          "Probar desde el navegador del móvil en la misma red (`--external`).",
          "Previsualizar el modo iOS/MD sin dispositivo con `?ionic:mode=ios`.",
        ],
        blocks: [
          {
            t: 'code',
            lang: 'bash',
            code: code`
              ionic serve                     # http://localhost:8100
              ionic serve --external          # listen on all interfaces (open from phone on same Wi-Fi)
              ionic serve --port=8200 --no-open

              # Equivalent with Angular CLI
              npx ng serve --port 8100

              # Preview iOS styling in a desktop browser
              # http://localhost:8100/?ionic:mode=ios
            `,
          },
          {
            t: 'table',
            head: ['Opción', 'Uso'],
            rows: [
              ['`--external`', 'Escucha en `0.0.0.0` para acceder desde otro dispositivo.'],
              ['`--port=<n>`', 'Cambia el puerto (por defecto `8100`).'],
              ['`--no-open`', 'No abre el navegador automáticamente.'],
              ['`--configuration=<name>`', 'Pasa la configuración a `ng serve` (p. ej. `production`) ⚠ verificar'],
            ],
          },
          {
            t: 'note',
            kind: 'warn',
            text: "En el navegador los plugins usan su **implementación web** (Preferences → `localStorage`, Camera → selector de archivo con `@ionic/pwa-elements`). CORS, safe areas, teclado y permisos solo se validan en dispositivo real.",
          },
        ],
        pitfalls: [
          "Dar por buena una funcionalidad porque funciona en `ionic serve`: en el WebView el origen y las restricciones son otras (ver [El WebView y el bridge](#/arquitectura/webview-bridge)).",
          "El Firewall de Windows bloquea `--external`: permite Node.js o el puerto 8100 en redes privadas.",
          "Diseñar solo en modo MD y descubrir tarde los estilos iOS: revisa ambos con `?ionic:mode=ios` / `?ionic:mode=md`.",
        ],
        links: [['ionic serve', 'https://ionicframework.com/docs/cli/commands/serve']],
      },
      {
        id: 'ionic-generate',
        title: '`ionic generate`: páginas, componentes y servicios',
        tags: ['ionic g', 'page', 'component', 'service', 'guard', 'schematics'],
        summary: "Genera código con los schematics de `@ionic/angular-toolkit` sobre Angular CLI. Las páginas incluyen estructura Ionic (`ion-header`, `ion-content`) y su ruta.",
        when: [
          "Crear páginas nuevas (componente + ruta lazy + estilos + spec).",
          "Crear servicios, guards, pipes y directivas con la convención del proyecto.",
        ],
        blocks: [
          {
            t: 'code',
            lang: 'bash',
            code: code`
              ionic generate page pages/login
              ionic g component components/user-avatar
              ionic g service core/services/payment
              ionic g guard core/guards/auth
              ionic g pipe shared/pipes/card-mask
              ionic g directive shared/directives/autofocus
              ionic g interface core/models/user
              ionic g class core/models/order
              ionic g enum core/models/payment-status

              # Angular CLI equivalent (anything that is not a "page")
              npx ng g service core/services/auth
            `,
          },
          {
            t: 'tabs',
            title: 'Resultado típico de `ionic g page pages/login` (standalone)',
            tabs: [
              {
                label: 'TypeScript',
                lang: 'ts',
                file: 'src/app/pages/login/login.page.ts',
                code: code`
                  import { Component } from '@angular/core';
                  import { IonContent, IonHeader, IonTitle, IonToolbar } from '@ionic/angular/standalone';

                  @Component({
                    selector: 'app-login',
                    templateUrl: './login.page.html',
                    styleUrls: ['./login.page.scss'],
                    imports: [IonContent, IonHeader, IonTitle, IonToolbar],
                  })
                  export class LoginPage {}
                `,
              },
              {
                label: 'Template',
                lang: 'html',
                file: 'login.page.html',
                code: code`
                  <ion-header [translucent]="true">
                    <ion-toolbar>
                      <ion-title>login</ion-title>
                    </ion-toolbar>
                  </ion-header>

                  <ion-content [fullscreen]="true">
                    <ion-header collapse="condense">
                      <ion-toolbar>
                        <ion-title size="large">login</ion-title>
                      </ion-toolbar>
                    </ion-header>
                  </ion-content>
                `,
              },
              {
                label: 'Ruta',
                lang: 'ts',
                file: 'src/app/app.routes.ts',
                code: code`
                  import { Routes } from '@angular/router';

                  export const routes: Routes = [
                    // Added by the schematic (lazy-loaded standalone component)
                    {
                      path: 'login',
                      loadComponent: () => import('./pages/login/login.page').then((m) => m.LoginPage),
                    },
                  ];
                `,
              },
            ],
          },
          {
            t: 'note',
            kind: 'info',
            text: "El schematic añade la ruta en `app.routes.ts` si lo encuentra ⚠ verificar. Revisa siempre que no quede duplicada o en el nivel equivocado (p. ej. debería ser hija de `tabs`).",
          },
        ],
        pitfalls: [
          "Crear páginas con `ng g component`: no genera ruta ni estructura de página Ionic.",
          "`'ion-xxx' is not a known element`: falta importar el componente Ionic en el array `imports` del standalone.",
          "Silenciar errores con `CUSTOM_ELEMENTS_SCHEMA`: oculta imports faltantes y rompe el binding con forms.",
          "Mezclar páginas NgModule y standalone sin criterio en el mismo proyecto.",
        ],
        links: [['ionic generate', 'https://ionicframework.com/docs/cli/commands/generate']],
      },
      {
        id: 'estructura',
        title: 'Estructura de un proyecto Ionic Angular',
        tags: ['main.ts', 'app.routes.ts', 'provideIonicAngular', 'IonicRouteStrategy', 'addIcons'],
        summary: "Proyecto Angular estándar + `capacitor.config.ts` + carpetas nativas `android/` e `ios/`. El arranque standalone registra Ionic con `provideIonicAngular()` y la estrategia de rutas `IonicRouteStrategy`.",
        when: [
          "Para ubicar dónde va cada cosa (providers globales, rutas, tema, assets).",
          "Al revisar un proyecto heredado o migrado y comparar con la estructura actual.",
        ],
        blocks: [
          {
            t: 'code',
            lang: 'text',
            code: code`
              my-app/
              ├── android/                  # native Android project (commit it)
              ├── ios/                      # native iOS project (commit it)
              ├── src/
              │   ├── app/
              │   │   ├── app.component.ts      # root: <ion-app> + <ion-router-outlet>
              │   │   ├── app.component.html
              │   │   ├── app.routes.ts         # top-level routes (loadComponent)
              │   │   ├── core/                 # services, guards, interceptors, models
              │   │   ├── shared/               # reusable components, pipes, directives
              │   │   └── pages/                # one folder per page
              │   ├── assets/                   # images, icons, i18n…
              │   ├── environments/             # environment.ts / environment.prod.ts
              │   ├── theme/variables.scss      # Ionic CSS variables (palette)
              │   ├── global.scss               # global styles + Ionic CSS imports
              │   ├── index.html
              │   └── main.ts                   # bootstrapApplication + providers
              ├── angular.json                  # build config (output → www)
              ├── capacitor.config.ts           # appId, appName, webDir, plugins
              ├── ionic.config.json             # Ionic CLI project config
              └── package.json
            `,
          },
          {
            t: 'tabs',
            title: 'Bootstrap de la app',
            tabs: [
              {
                label: 'Standalone',
                lang: 'ts',
                file: 'src/main.ts',
                code: code`
                  import { bootstrapApplication } from '@angular/platform-browser';
                  import { PreloadAllModules, RouteReuseStrategy, provideRouter, withPreloading } from '@angular/router';
                  import { provideHttpClient, withInterceptors } from '@angular/common/http';
                  import { IonicRouteStrategy, provideIonicAngular } from '@ionic/angular/standalone';

                  import { routes } from './app/app.routes';
                  import { AppComponent } from './app/app.component';

                  bootstrapApplication(AppComponent, {
                    providers: [
                      // Keeps Ionic page stack + transitions working with the Angular router
                      { provide: RouteReuseStrategy, useClass: IonicRouteStrategy },
                      provideIonicAngular(), // global config: provideIonicAngular({ mode: 'ios' })
                      provideRouter(routes, withPreloading(PreloadAllModules)),
                      provideHttpClient(withInterceptors([])),
                    ],
                  });
                `,
              },
              {
                label: 'Legacy',
                lang: 'ts',
                file: 'src/app/app.module.ts (legacy)',
                code: code`
                  // Legacy NgModule approach — IonicModule registers every Ionic component
                  import { NgModule } from '@angular/core';
                  import { BrowserModule } from '@angular/platform-browser';
                  import { RouteReuseStrategy } from '@angular/router';
                  import { IonicModule, IonicRouteStrategy } from '@ionic/angular';

                  import { AppComponent } from './app.component';
                  import { AppRoutingModule } from './app-routing.module';

                  @NgModule({
                    declarations: [AppComponent],
                    imports: [BrowserModule, IonicModule.forRoot(), AppRoutingModule],
                    providers: [{ provide: RouteReuseStrategy, useClass: IonicRouteStrategy }],
                    bootstrap: [AppComponent],
                  })
                  export class AppModule {}

                  // main.ts
                  // platformBrowserDynamic().bootstrapModule(AppModule).catch((err) => console.error(err));
                `,
              },
            ],
          },
          {
            t: 'tabs',
            title: 'Componente raíz e iconos (standalone)',
            tabs: [
              {
                label: 'TypeScript',
                lang: 'ts',
                file: 'src/app/app.component.ts',
                code: code`
                  import { Component } from '@angular/core';
                  import { IonApp, IonRouterOutlet } from '@ionic/angular/standalone';
                  import { addIcons } from 'ionicons';
                  import { homeOutline, settingsOutline, cardOutline } from 'ionicons/icons';

                  @Component({
                    selector: 'app-root',
                    templateUrl: 'app.component.html',
                    imports: [IonApp, IonRouterOutlet],
                  })
                  export class AppComponent {
                    constructor() {
                      // Standalone: icons must be registered explicitly (tree-shakable)
                      addIcons({ homeOutline, settingsOutline, cardOutline });
                    }
                  }
                `,
              },
              {
                label: 'Template',
                lang: 'html',
                file: 'app.component.html',
                code: code`
                  <ion-app>
                    <ion-router-outlet></ion-router-outlet>
                  </ion-app>

                  <!-- Anywhere in the app (camelCase key → kebab-case name) -->
                  <!-- <ion-icon name="settings-outline"></ion-icon> -->
                `,
              },
            ],
          },
          {
            t: 'note',
            kind: 'info',
            text: "Angular recientes generan `public/` en lugar de `src/assets/` en proyectos nuevos; las plantillas de Ionic pueden seguir usando `src/assets/` ⚠ verificar. Mira `angular.json` → `assets` para saber cuál aplica.",
          },
        ],
        pitfalls: [
          "Iconos que no aparecen en standalone: falta `addIcons(...)` (en legacy se cargaban solos).",
          "Quitar `IonicRouteStrategy`: se pierden el cache de páginas y las transiciones del stack.",
          "Mezclar imports de `@ionic/angular` y `@ionic/angular/standalone` en la misma app.",
          "Añadir `android/` o `ios/` al `.gitignore`: se pierden permisos, iconos y configuración de firma.",
        ],
        links: [
          ['Standalone vs NgModule', 'https://ionicframework.com/docs/angular/build-options'],
          ['Ionic Angular overview', 'https://ionicframework.com/docs/angular/overview'],
          ['Ionicons', 'https://ionic.io/ionicons'],
        ],
      },
      {
        id: 'capacitor-config',
        title: '`capacitor.config.ts`',
        tags: ['appId', 'webDir', 'server', 'androidScheme', 'plugins', 'cleartext'],
        summary: "Configuración central de Capacitor: identificador, carpeta web compilada, comportamiento del servidor interno del WebView y opciones por plugin. Se copia a los proyectos nativos en cada `cap copy`/`cap sync`.",
        when: [
          "Al crear el proyecto (appId/appName/webDir).",
          "Para configurar plugins (SplashScreen, Keyboard, PushNotifications…).",
          "Para live reload o entornos (`server.url`, solo desarrollo).",
        ],
        blocks: [
          {
            t: 'code',
            lang: 'ts',
            file: 'capacitor.config.ts',
            code: code`
              import type { CapacitorConfig } from '@capacitor/cli';
              import { KeyboardResize } from '@capacitor/keyboard';

              const config: CapacitorConfig = {
                appId: 'com.company.myapp', // reverse-domain, unique in the stores
                appName: 'My App',
                webDir: 'www', // must contain the built index.html
                server: {
                  androidScheme: 'https', // default; changing it changes the app origin
                  // url: 'http://192.168.1.10:8100', // live reload only — NEVER ship this
                  // cleartext: true,                 // allow http:// on Android (dev only)
                },
                android: {
                  allowMixedContent: false,
                },
                ios: {
                  contentInset: 'automatic',
                },
                plugins: {
                  SplashScreen: {
                    launchShowDuration: 2000,
                    launchAutoHide: true,
                  },
                  Keyboard: {
                    resize: KeyboardResize.Body,
                  },
                },
              };

              export default config;
            `,
          },
          {
            t: 'table',
            title: 'Opciones clave (valores por defecto según la doc de Capacitor 8)',
            head: ['Opción', 'Default', 'Para qué'],
            rows: [
              ['`appId`', '—', 'Bundle ID / applicationId. Debe coincidir con Gradle y Xcode.'],
              ['`webDir`', '—', 'Carpeta con el `index.html` compilado.'],
              ['`server.androidScheme`', '`https`', 'Origen en Android: `https://localhost`.'],
              ['`server.iosScheme`', '`capacitor`', 'Origen en iOS: `capacitor://localhost`.'],
              ['`server.hostname`', '`localhost`', 'Host del origen local.'],
              ['`server.url`', '—', 'Carga una URL externa. Solo live reload, no producción.'],
              ['`server.cleartext`', '`false`', 'Permite tráfico `http://` en Android (API 28+ lo bloquea).'],
              ['`server.allowNavigation`', '`[]`', 'Dominios externos que pueden abrirse dentro del WebView.'],
              ['`android.allowMixedContent`', '`false`', 'Permite contenido http en origen https.'],
              ['`ios.contentInset`', '`never`', 'Ajuste del scroll view del WebView.'],
              ['`loggingBehavior`', '`debug`', 'Logs del bridge: `none` | `debug` | `production`.'],
              ['`plugins.<Nombre>`', '—', 'Configuración específica de cada plugin.'],
            ],
          },
        ],
        pitfalls: [
          "`webDir` no coincide con la salida del build (p. ej. `www/browser` con el builder `application`): la app abre en blanco. Revisa `outputPath` en `angular.json`.",
          "Publicar con `server.url` activo: la app intenta cargar desde tu PC y queda en blanco.",
          "Cambiar `appId` solo en este archivo: también hay que cambiar `applicationId`/`namespace` en `android/app/build.gradle` y el Bundle Identifier en Xcode.",
          "Cambiar `androidScheme` (p. ej. de `http` a `https`) en una app publicada: cambia el origen y se pierden `localStorage`, IndexedDB y cookies de los usuarios.",
          "Editar el config y no ejecutar `npx cap sync`/`copy`: los nativos siguen con el valor anterior.",
        ],
        links: [['Capacitor config', 'https://capacitorjs.com/docs/config']],
      },
      {
        id: 'cap-cli',
        title: 'Comandos `npx cap`: add, sync, copy, run, open',
        tags: ['npx cap', 'sync', 'copy', 'update', 'run', 'open', 'doctor'],
        summary: "El CLI de Capacitor añade plataformas nativas, copia el build web a ellas, instala dependencias nativas de los plugins y ejecuta/abre los proyectos en Android Studio o Xcode.",
        when: [
          "Después de cada `ng build` que quieras ver en el dispositivo (`sync` o `copy`).",
          "Siempre después de instalar/actualizar un plugin (`sync`).",
          "Para diagnosticar versiones (`doctor`) y listar plugins detectados (`ls`).",
        ],
        blocks: [
          {
            t: 'code',
            lang: 'bash',
            code: code`
              # Add Capacitor to an existing Angular project
              npm install @capacitor/core
              npm install -D @capacitor/cli
              npx cap init "My App" com.company.myapp --web-dir=www

              # Native platforms
              npm install @capacitor/android @capacitor/ios
              npx cap add android
              npx cap add ios                 # macOS only for building

              # Daily workflow: build web → sync → run/open
              npx ng build                    # or: ionic build
              npx cap sync                    # copy web assets + update native deps
              npx cap run android             # pick device/emulator, build & install
              npx cap run android --list      # list targets
              npx cap open android            # open Android Studio
              npx cap open ios                # open Xcode

              # Diagnostics
              npx cap doctor
              npx cap ls
            `,
          },
          {
            t: 'table',
            head: ['Comando', 'Qué hace'],
            rows: [
              ['`npx cap add <platform>`', 'Crea `android/` o `ios/` desde la plantilla nativa.'],
              ['`npx cap copy [platform]`', 'Copia `webDir` y la config a los nativos. Rápido; no toca plugins.'],
              ['`npx cap update [platform]`', 'Actualiza dependencias nativas de los plugins (Gradle, Pods/SPM).'],
              ['`npx cap sync [platform]`', '`copy` + `update`. El comando "por defecto".'],
              ['`npx cap run <platform>`', '`sync` + compila e instala en un dispositivo. Flags: `--target`, `--list`, `--no-sync`, `--live-reload`, `--flavor`.'],
              ['`npx cap open <platform>`', 'Abre el proyecto en Android Studio / Xcode.'],
              ['`npx cap build <platform>`', 'Compila el binario de release desde CLI (firma con opciones de keystore).'],
              ['`npx cap doctor`', 'Muestra versiones instaladas y detecta desalineaciones.'],
              ['`npx cap ls`', 'Lista plugins Capacitor y Cordova detectados.'],
              ['`npx cap migrate`', 'Asistente para actualizar a un nuevo major de Capacitor.'],
            ],
          },
          {
            t: 'tabs',
            title: 'Atajos con el CLI de Ionic',
            tabs: [
              {
                label: 'Android',
                lang: 'bash',
                code: code`
                  ionic cap sync android
                  ionic cap run android            # ionic build + sync + run
                  ionic cap build android          # ionic build + sync + open Android Studio
                `,
              },
              {
                label: 'iOS',
                lang: 'bash',
                code: code`
                  ionic cap sync ios
                  ionic cap run ios
                  ionic cap build ios              # ionic build + sync + open Xcode
                `,
              },
            ],
          },
          {
            t: 'note',
            kind: 'info',
            text: "En iOS las dependencias nativas pueden gestionarse con CocoaPods o Swift Package Manager según la versión y cómo se añadió la plataforma ⚠ verificar en la guía de iOS de Capacitor 8.",
          },
        ],
        pitfalls: [
          "Hacer `sync` sin `build` previo: copias un `www/` viejo y \"no aparecen los cambios\".",
          "Instalar un plugin y no hacer `sync`: error `\"X\" plugin is not implemented on android`.",
          "Versiones mezcladas de `@capacitor/core`, `cli`, `android`, `ios` y plugins oficiales: mantén el mismo major (revisa con `npx cap doctor`).",
          "Intentar `npx cap open ios` / compilar iOS desde Windows: necesitas macOS con Xcode.",
        ],
        links: [
          ['Capacitor CLI', 'https://capacitorjs.com/docs/cli'],
          ['Workflow de desarrollo', 'https://capacitorjs.com/docs/basics/workflow'],
        ],
      },
      {
        id: 'live-reload',
        title: 'Live reload en dispositivo',
        tags: ['live reload', '-l', '--external', 'adb reverse', 'forwardPorts', 'chrome://inspect'],
        summary: "La app nativa carga la web desde el dev server de tu PC: plugins nativos reales + recarga automática al guardar.",
        when: [
          "Desarrollar funcionalidades que dependen de plugins nativos (cámara, biometría, push…).",
          "Ajustar UI con teclado, safe areas y gestos reales.",
        ],
        blocks: [
          {
            t: 'tabs',
            tabs: [
              {
                label: 'Android',
                lang: 'bash',
                code: code`
                  # Option A — Ionic CLI (starts ng serve and points the app to it)
                  ionic cap run android -l --external

                  # Option B — your own dev server + Capacitor CLI
                  npx ng serve --host 0.0.0.0 --port 8100
                  npx cap run android --live-reload --host 192.168.1.10 --port 8100

                  # USB device, no shared Wi-Fi: adb reverse via --forwardPorts
                  npx cap run android --live-reload --host localhost --port 8100 --forwardPorts 8100:8100
                `,
              },
              {
                label: 'iOS',
                lang: 'bash',
                code: code`
                  ionic cap run ios -l --external

                  # or with Capacitor CLI
                  npx cap run ios --live-reload --host 192.168.1.10 --port 8100
                `,
              },
              {
                label: 'Windows firewall',
                lang: 'powershell',
                code: code`
                  # Run in an elevated PowerShell: allow inbound dev-server traffic on port 8100
                  New-NetFirewallRule -DisplayName "Ionic dev server 8100" -Direction Inbound -LocalPort 8100 -Protocol TCP -Action Allow -Profile Private
                `,
              },
            ],
          },
          {
            t: 'list',
            title: 'Cómo funciona y cómo depurar',
            items: [
              "El CLI escribe temporalmente `server.url` en la config del proyecto nativo para que el WebView cargue `http://<tu-ip>:8100`.",
              "PC y dispositivo deben estar en la misma red (o usar `--forwardPorts` por USB en Android).",
              "Depura el WebView: Android → `chrome://inspect` en Chrome; iOS → Safari › Desarrollo › (dispositivo).",
              "Si ves `net::ERR_CLEARTEXT_NOT_PERMITTED`, añade temporalmente `server.cleartext: true` (solo dev).",
            ],
          },
        ],
        pitfalls: [
          "Tras una sesión de live reload, generar el build normal sin `npx cap sync`: la app sigue apuntando a tu IP y abre en blanco.",
          "La IP del PC cambió (DHCP) o estás en VPN corporativa: el dispositivo no llega al servidor.",
          "En el emulador Android `localhost` es el propio emulador; para llegar al PC usa `10.0.2.2` o `--forwardPorts`.",
          "El backend usa HTTPS con certificado autofirmado: el WebView lo rechaza.",
        ],
        links: [
          ['Live reload (Capacitor)', 'https://capacitorjs.com/docs/guides/live-reload'],
          ['cap run', 'https://capacitorjs.com/docs/cli/commands/run'],
          ['Live reload (Ionic CLI)', 'https://ionicframework.com/docs/cli/livereload'],
        ],
      },
    ],
  },

  /* ===================================================================
     2. ARQUITECTURA
     =================================================================== */
  {
    id: 'arquitectura',
    num: 2,
    title: 'Arquitectura',
    desc: "Cómo se combinan Angular, Ionic y Capacitor; el WebView, el bridge nativo y qué corre dónde.",
    topics: [
      {
        id: 'capas',
        title: 'Cómo encajan Ionic, Angular y Capacitor',
        tags: ['arquitectura', 'capas', 'runtime', 'WebView'],
        summary: "**Angular** estructura la app (componentes, DI, router, forms). **Ionic** aporta la UI móvil como Web Components con wrappers para Angular. **Capacitor** empaqueta la web en una app nativa y expone APIs nativas mediante plugins.",
        when: [
          "Para decidir en qué capa resolver un problema (¿es de UI, de Angular o nativo?).",
          "Para explicar el stack a alguien que viene de nativo o de Cordova.",
        ],
        blocks: [
          {
            t: 'code',
            lang: 'text',
            code: code`
              Native app shell (APK/AAB · IPA)
              │
              ├── WebView (Android System WebView · iOS WKWebView)
              │   └── www/  ← output of "ng build", bundled inside the binary
              │       ├── Angular          → components, DI, router, forms, HttpClient
              │       ├── Ionic            → <ion-*> Web Components + Angular wrappers
              │       └── @capacitor/core  → JS proxies: Preferences.get(), Camera…
              │                │
              │                │  Bridge: async calls, JSON-serializable data, events
              │                ▼
              ├── Capacitor runtime (native)
              │   └── Plugins → Kotlin/Java (Android) · Swift (iOS)
              │                │
              │                ▼
              └── OS APIs: camera, filesystem, GPS, push, biometrics, Keystore/Keychain…
            `,
          },
          {
            t: 'table',
            title: 'Quién se encarga de qué',
            head: ['Responsabilidad', 'Capa', 'Notas'],
            rows: [
              ['Componentes, DI, servicios, forms', 'Angular', 'Igual que en una app web Angular.'],
              ['Rutas', 'Angular Router', 'Ionic añade `ion-router-outlet` (stack + transiciones) y `IonicRouteStrategy`.'],
              ['UI móvil y gestos', 'Ionic', '`ion-*`, modos `ios`/`md`, overlays, swipe-back.'],
              ['Theming', 'Ionic', 'Variables CSS (`--ion-color-*`), shadow parts.'],
              ['Acceso a hardware y SO', 'Capacitor', 'Plugins oficiales, comunitarios o propios.'],
              ['Compilar la web', 'Angular CLI', 'Genera `www/`.'],
              ['Compilar el binario', 'Gradle / Xcode', 'Firmado, versionado, permisos.'],
            ],
          },
        ],
        pitfalls: [
          "Pensar que Ionic genera UI nativa: es UI web dentro de un WebView, con estilos que imitan cada plataforma.",
          "Confundir versiones: Ionic, Angular y Capacitor tienen ciclos de release independientes; revisa compatibilidad de cada uno por separado.",
          "Meter lógica de negocio en código nativo cuando puede vivir en TypeScript (más fácil de testear y compartir con web).",
        ],
        links: [
          ['Ionic: Web View', 'https://ionicframework.com/docs/core-concepts/webview'],
          ['Capacitor: introducción', 'https://capacitorjs.com/docs'],
        ],
      },
      {
        id: 'webview-bridge',
        title: 'El WebView y el bridge nativo',
        tags: ['WebView', 'WKWebView', 'origen', 'https://localhost', 'capacitor://localhost', 'bridge', 'CORS'],
        summary: "La web compilada se sirve desde dentro del binario bajo un **origen local propio**. Las llamadas a plugins viajan por un bridge asíncrono: devuelven Promises y los datos deben ser serializables a JSON.",
        when: [
          "Para entender errores de CORS, cookies o almacenamiento que solo pasan en dispositivo.",
          "Al diseñar llamadas a plugins (qué datos pasar, listeners, rendimiento).",
        ],
        blocks: [
          {
            t: 'table',
            title: 'Origen de la app según el entorno',
            head: ['Entorno', 'Origen', 'Motor'],
            rows: [
              ['Android', '`https://localhost`', 'Android System WebView (Chromium, se actualiza vía Play Store).'],
              ['iOS', '`capacitor://localhost`', 'WKWebView (ligado a la versión de iOS).'],
              ['`ionic serve`', '`http://localhost:8100`', 'Tu navegador de escritorio.'],
              ['Live reload', '`http://<ip>:8100`', 'WebView del dispositivo cargando tu dev server.'],
            ],
          },
          {
            t: 'note',
            kind: 'warn',
            text: "Consecuencia directa: el backend debe aceptar los orígenes `https://localhost` y `capacitor://localhost` en CORS, o usar `CapacitorHttp` (petición nativa, sin CORS).",
          },
          {
            t: 'tabs',
            tabs: [
              {
                label: 'Detección',
                lang: 'ts',
                code: code`
                  import { Capacitor } from '@capacitor/core';

                  Capacitor.isNativePlatform();          // true on Android/iOS, false on web
                  Capacitor.getPlatform();               // 'android' | 'ios' | 'web'
                  Capacitor.isPluginAvailable('Camera'); // plugin available on the current platform?

                  // Native file path/URI → URL the WebView can load (e.g. <img [src]>)
                  const src = Capacitor.convertFileSrc('file:///data/user/0/com.company.myapp/files/photo.jpg');
                `,
              },
              {
                label: 'Llamada a plugin',
                lang: 'ts',
                code: code`
                  import { Preferences } from '@capacitor/preferences';

                  // JS proxy → bridge → native (SharedPreferences / UserDefaults) → Promise
                  export async function markOnboardingDone(): Promise<void> {
                    await Preferences.set({ key: 'onboardingDone', value: 'true' });
                  }

                  export async function isOnboardingDone(): Promise<boolean> {
                    const { value } = await Preferences.get({ key: 'onboardingDone' });
                    return value === 'true';
                  }
                `,
              },
              {
                label: 'Eventos nativos',
                lang: 'ts',
                code: code`
                  import { Injectable, OnDestroy } from '@angular/core';
                  import { App } from '@capacitor/app';
                  import type { PluginListenerHandle } from '@capacitor/core';

                  @Injectable({ providedIn: 'root' })
                  export class AppStateService implements OnDestroy {
                    private handle?: PluginListenerHandle;

                    async start(): Promise<void> {
                      // Native event → bridge → JS callback
                      this.handle = await App.addListener('appStateChange', ({ isActive }) => {
                        console.log('App active?', isActive);
                      });
                    }

                    ngOnDestroy(): void {
                      // Always remove listeners to avoid duplicates and leaks
                      void this.handle?.remove();
                    }
                  }
                `,
              },
            ],
          },
        ],
        pitfalls: [
          "Pasar imágenes o ficheros grandes en base64 por el bridge: es lento y consume memoria. Trabaja con rutas/URIs y `Filesystem`.",
          "Registrar listeners en páginas cacheadas sin eliminarlos: se duplican cada vez que entras.",
          "Olvidar `await`: el plugin aún no terminó cuando usas el resultado.",
          "Emuladores sin Play Store o Android antiguos con WebView desactualizado: APIs JS/CSS modernas fallan.",
        ],
        links: [
          ['Ionic: Web View', 'https://ionicframework.com/docs/core-concepts/webview'],
          ['Capacitor: Web/JS API', 'https://capacitorjs.com/docs/core-apis/web'],
          ['CapacitorHttp', 'https://capacitorjs.com/docs/apis/http'],
        ],
      },
      {
        id: 'web-components',
        title: 'Ionic: Web Components, wrappers y standalone',
        tags: ['@ionic/core', 'Stencil', 'shadow DOM', '@ionic/angular/standalone', 'IonicModule', 'legacy'],
        summary: "Los `ion-*` son Custom Elements hechos con Stencil (`@ionic/core`), muchos con Shadow DOM. `@ionic/angular` los envuelve para integrarlos con Angular (forms, router, overlays). Con standalone importas solo lo que usas.",
        when: [
          "Para entender por qué hay que importar cada componente en standalone.",
          "Cuando un estilo no aplica (Shadow DOM) o un control no se integra con Reactive Forms.",
        ],
        blocks: [
          {
            t: 'tabs',
            title: 'Una página con componente + controller',
            tabs: [
              {
                label: 'Standalone',
                lang: 'ts',
                file: 'home.page.ts',
                code: code`
                  import { Component, inject } from '@angular/core';
                  import {
                    IonButton,
                    IonContent,
                    IonHeader,
                    IonTitle,
                    IonToolbar,
                    ToastController,
                  } from '@ionic/angular/standalone';

                  @Component({
                    selector: 'app-home',
                    templateUrl: './home.page.html',
                    styleUrls: ['./home.page.scss'],
                    imports: [IonHeader, IonToolbar, IonTitle, IonContent, IonButton],
                  })
                  export class HomePage {
                    private readonly toastCtrl = inject(ToastController);

                    async greet(): Promise<void> {
                      const toast = await this.toastCtrl.create({ message: 'Hola', duration: 1500 });
                      await toast.present();
                    }
                  }
                `,
              },
              {
                label: 'Legacy',
                lang: 'ts',
                file: 'home.page.ts (legacy)',
                code: code`
                  // Legacy: IonicModule registers ALL Ionic components (no tree-shaking)
                  import { Component } from '@angular/core';
                  import { IonicModule, ToastController } from '@ionic/angular';

                  @Component({
                    selector: 'app-home',
                    templateUrl: './home.page.html',
                    standalone: true,
                    imports: [IonicModule],
                  })
                  export class HomePage {
                    constructor(private readonly toastCtrl: ToastController) {}

                    async greet(): Promise<void> {
                      const toast = await this.toastCtrl.create({ message: 'Hola', duration: 1500 });
                      await toast.present();
                    }
                  }
                `,
              },
              {
                label: 'Template',
                lang: 'html',
                file: 'home.page.html',
                code: code`
                  <ion-header [translucent]="true">
                    <ion-toolbar>
                      <ion-title>Home</ion-title>
                    </ion-toolbar>
                  </ion-header>

                  <ion-content [fullscreen]="true" class="ion-padding">
                    <ion-button expand="block" (click)="greet()">Saludar</ion-button>
                  </ion-content>
                `,
              },
            ],
          },
          {
            t: 'table',
            title: 'Standalone vs legacy',
            head: ['Aspecto', 'Standalone (recomendado)', 'Legacy (`IonicModule`)'],
            rows: [
              ['Imports', 'Cada componente: `IonButton`, `IonList`…', '`IonicModule` una vez.'],
              ['Paquete', '`@ionic/angular/standalone`', '`@ionic/angular`'],
              ['Bootstrap', '`provideIonicAngular()`', '`IonicModule.forRoot()`'],
              ['Iconos', '`addIcons({...})` explícito', 'Cargados automáticamente.'],
              ['Bundle', 'Tree-shaking: solo lo usado.', 'Incluye todos los componentes.'],
              ['Controllers', 'Desde `@ionic/angular/standalone`.', 'Desde `@ionic/angular`.'],
            ],
          },
          {
            t: 'note',
            kind: 'info',
            text: "Por el Shadow DOM, tus estilos globales no entran en el componente: personaliza con **variables CSS** (`--background`, `--color`…) y **`::part()`**. Detalle en la sección de Theming y Troubleshooting.",
          },
        ],
        pitfalls: [
          "Importar un controller (`ModalController`, `ToastController`…) desde `@ionic/angular` en una app standalone: mezcla dos sistemas de registro y provoca errores difíciles de depurar.",
          "`'ion-button' is not a known element`: falta añadirlo a `imports` del componente.",
          "Usar `CUSTOM_ELEMENTS_SCHEMA` como parche: los wrappers no se cargan y fallan forms/eventos.",
          "Intentar estilar el interior con selectores normales (`ion-button button {}`): no atraviesan el Shadow DOM.",
        ],
        links: [
          ['Standalone vs NgModule', 'https://ionicframework.com/docs/angular/build-options'],
          ['CSS Shadow Parts', 'https://ionicframework.com/docs/theming/css-shadow-parts'],
          ['CSS Variables', 'https://ionicframework.com/docs/theming/css-variables'],
        ],
      },
      {
        id: 'que-corre-donde',
        title: 'Qué corre dónde (web vs nativo) y detección de plataforma',
        tags: ['Platform', 'platform.is', 'hybrid', 'mobileweb', 'pause', 'resume', 'getPlatform'],
        summary: "Todo tu TypeScript corre en el motor JS del WebView; solo el código de los plugins corre nativo. Usa `Platform` de Ionic para decisiones de UI y `Capacitor.getPlatform()` para decisiones sobre APIs nativas.",
        when: [
          "Para elegir entre una API web y un plugin (HTTP, almacenamiento, ficheros).",
          "Para adaptar UI o lógica según plataforma y ciclo de vida de la app (pause/resume).",
        ],
        blocks: [
          {
            t: 'table',
            head: ['Pieza', 'Dónde corre', 'Implicación'],
            rows: [
              ['Templates, servicios, RxJS', 'WebView (JS)', 'Se pausa cuando la app va a segundo plano.'],
              ['`HttpClient`', 'WebView', 'Sujeto a CORS y a la política de cookies del WebView.'],
              ['`CapacitorHttp`', 'Nativo', 'Sin CORS; activable para parchear `fetch`/XHR.'],
              ['`@capacitor/preferences`', 'Nativo', 'Android SharedPreferences · iOS UserDefaults · Web `localStorage`. No cifrado.'],
              ['`localStorage` / IndexedDB', 'WebView', 'Ligados al origen; el SO puede purgarlos en casos de poco espacio.'],
              ['Push, biometría, cámara', 'Nativo (plugin)', 'Requieren permisos en `AndroidManifest.xml` / `Info.plist`.'],
              ['Tareas en background', 'Nativo', 'El JS no se ejecuta en background: necesitas plugins específicos.'],
            ],
          },
          {
            t: 'tabs',
            tabs: [
              {
                label: 'Platform (Ionic)',
                lang: 'ts',
                code: code`
                  import { Component, DestroyRef, OnInit, inject } from '@angular/core';
                  import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
                  import { Platform } from '@ionic/angular/standalone';

                  @Component({ selector: 'app-root', template: '', imports: [] })
                  export class AppComponent implements OnInit {
                    private readonly platform = inject(Platform);
                    private readonly destroyRef = inject(DestroyRef);

                    async ngOnInit(): Promise<void> {
                      await this.platform.ready();

                      if (this.platform.is('capacitor')) {
                        // running inside the native app (Android or iOS)
                      }
                      if (this.platform.is('mobileweb')) {
                        // mobile browser (not the native app)
                      }

                      this.platform.pause.pipe(takeUntilDestroyed(this.destroyRef)).subscribe(() => {
                        // app went to background: stop timers, save state
                      });
                      this.platform.resume.pipe(takeUntilDestroyed(this.destroyRef)).subscribe(() => {
                        // app back to foreground: refresh session/data
                      });
                    }
                  }
                `,
              },
              {
                label: 'Capacitor',
                lang: 'ts',
                code: code`
                  import { Capacitor } from '@capacitor/core';

                  // Decide which implementation to use for a native capability
                  export function storageBackend(): 'native' | 'web' {
                    return Capacitor.isNativePlatform() ? 'native' : 'web';
                  }

                  export const isAndroid = Capacitor.getPlatform() === 'android';
                  export const isIOS = Capacitor.getPlatform() === 'ios';
                `,
              },
            ],
          },
          {
            t: 'table',
            title: 'Valores útiles de `platform.is()`',
            head: ['Valor', 'Verdadero cuando…'],
            rows: [
              ['`capacitor`', 'Corre dentro de una app Capacitor.'],
              ['`hybrid`', 'Corre en Capacitor o Cordova.'],
              ['`android` / `ios`', 'El dispositivo es Android / iOS (también en navegador móvil).'],
              ['`mobileweb`', 'Navegador en un dispositivo móvil (no app nativa).'],
              ['`desktop`', 'Navegador de escritorio.'],
              ['`pwa`', 'Instalada como PWA.'],
              ['`tablet` / `ipad` / `iphone`', 'Tipo de dispositivo según heurística de user agent y tamaño.'],
            ],
          },
        ],
        pitfalls: [
          "Usar `platform.is('ios')` para decidir si llamar a un plugin: también es `true` en Safari móvil. Usa `Capacitor.isNativePlatform()`.",
          "Confundir **plataforma** con **modo** (`ios`/`md`): el modo es solo estilo y puede forzarse.",
          "Suscribirse a `pause`/`resume` sin desuscribirse.",
          "Guardar tokens o datos sensibles en `Preferences` o `localStorage`: no están cifrados.",
        ],
        links: [
          ['Platform (Ionic Angular)', 'https://ionicframework.com/docs/angular/platform'],
          ['Capacitor Web/JS API', 'https://capacitorjs.com/docs/core-apis/web'],
        ],
      },
      {
        id: 'proyectos-nativos',
        title: 'Los proyectos nativos son código fuente',
        tags: ['android/', 'ios/', 'AndroidManifest.xml', 'Info.plist', 'build.gradle', 'git'],
        summary: "A diferencia de Cordova, `android/` e `ios/` se versionan en git y se editan directamente. Capacitor solo regenera partes concretas en cada `sync` (assets web y archivos `capacitor.*`).",
        when: [
          "Al añadir permisos, deep links, iconos, firma o capacidades (push, Sign in with Apple…).",
          "Al decidir qué subir a git y qué se puede regenerar.",
        ],
        blocks: [
          {
            t: 'table',
            head: ['Archivo', 'Qué configuras'],
            rows: [
              ['`android/app/src/main/AndroidManifest.xml`', 'Permisos, intent-filters (deep links), `usesCleartextTraffic`.'],
              ['`android/app/build.gradle`', '`applicationId`, `namespace`, `versionCode`, `versionName`, firma.'],
              ['`android/variables.gradle`', '`minSdkVersion`, `compileSdkVersion`, `targetSdkVersion`, versiones de libs.'],
              ['`android/app/src/main/res/`', 'Iconos, splash, `xml/network_security_config.xml`, strings.'],
              ['`ios/App/App/Info.plist`', 'Textos de permisos (`NS…UsageDescription`), URL schemes.'],
              ['Proyecto Xcode (`ios/App`)', 'Bundle ID, signing, capabilities, versión y build.'],
              ['Regenerados en `sync` (no editar)', '`android/app/src/main/assets/public/`, `ios/App/App/public/`, `capacitor.config.json`, `capacitor.plugins.json`.'],
            ],
          },
          {
            t: 'tabs',
            title: 'Ejemplo: permiso de cámara',
            tabs: [
              {
                label: 'Android',
                lang: 'xml',
                file: 'android/app/src/main/AndroidManifest.xml',
                code: code`
                  <?xml version="1.0" encoding="utf-8"?>
                  <manifest xmlns:android="http://schemas.android.com/apk/res/android">

                      <!-- Permissions go at manifest level, outside <application> -->
                      <uses-permission android:name="android.permission.INTERNET" />
                      <uses-permission android:name="android.permission.CAMERA" />

                      <application
                          android:label="@string/app_name"
                          android:icon="@mipmap/ic_launcher"
                          android:usesCleartextTraffic="false">
                          <!-- activities, providers… -->
                      </application>
                  </manifest>
                `,
              },
              {
                label: 'iOS',
                lang: 'plist',
                file: 'ios/App/App/Info.plist',
                code: code`
                  <!-- Inside the root <dict>: user-facing reason shown in the permission prompt -->
                  <key>NSCameraUsageDescription</key>
                  <string>Necesitamos la cámara para escanear tu tarjeta.</string>
                  <key>NSPhotoLibraryUsageDescription</key>
                  <string>Necesitamos acceso a tus fotos para elegir tu avatar.</string>
                `,
              },
            ],
          },
        ],
        pitfalls: [
          "Poner `android/` o `ios/` en `.gitignore`: se pierden permisos, iconos y firma.",
          "Editar archivos dentro de `assets/public`: se sobrescriben en cada `sync`.",
          "Borrar y volver a añadir una plataforma para \"arreglar\" algo: se pierde toda la personalización.",
          "Subir de major de Capacitor sin seguir la guía de actualización (o `npx cap migrate`): versiones de Gradle/SDK desalineadas.",
          "En iOS, falta el texto `NS…UsageDescription`: la app se cierra al pedir el permiso.",
        ],
        links: [
          ['Capacitor Android', 'https://capacitorjs.com/docs/android'],
          ['Configurar Android', 'https://capacitorjs.com/docs/android/configuration'],
          ['Capacitor iOS', 'https://capacitorjs.com/docs/ios'],
          ['Configurar iOS', 'https://capacitorjs.com/docs/ios/configuration'],
        ],
      },
    ],
  },
  /* ===================================================================
     3. NAVEGACIÓN
     =================================================================== */
  {
    id: 'navegacion',
    num: 3,
    title: 'Navegación',
    desc: "`ion-router-outlet`, tabs, menú lateral, `NavController` frente a `Router`, el stack de páginas y el botón atrás de Android.",
    topics: [
      {
        id: 'router-outlet',
        title: '`ion-router-outlet` y rutas lazy',
        tags: ['ion-router-outlet', 'loadComponent', 'routerLink', 'IonRouterLink', 'routerDirection', 'withComponentInputBinding'],
        summary: "Ionic usa el Router de Angular, pero sustituye `<router-outlet>` por `<ion-router-outlet>`, que mantiene un **stack** de páginas y anima las transiciones según la dirección (forward/back/root).",
        when: [
          "Siempre que la app tenga páginas navegables (es el outlet raíz en `app.component.html`).",
          "Dentro de un componente de tabs, cada tab tiene su propio outlet gestionado por `ion-tabs`.",
        ],
        blocks: [
          {
            t: 'code',
            lang: 'ts',
            file: 'src/app/app.routes.ts',
            code: code`
              import { Routes } from '@angular/router';
              import { authGuard } from './core/guards/auth.guard';

              export const routes: Routes = [
                { path: '', redirectTo: 'login', pathMatch: 'full' },
                {
                  path: 'login',
                  loadComponent: () => import('./pages/login/login.page').then((m) => m.LoginPage),
                },
                {
                  path: 'payments/:id',
                  canActivate: [authGuard],
                  loadComponent: () => import('./pages/payment-detail/payment-detail.page').then((m) => m.PaymentDetailPage),
                },
                {
                  path: 'tabs',
                  canActivate: [authGuard],
                  loadChildren: () => import('./pages/tabs/tabs.routes').then((m) => m.TABS_ROUTES),
                },
                { path: '**', redirectTo: 'login' },
              ];
            `,
          },
          {
            t: 'tabs',
            title: 'Links con dirección de animación',
            tabs: [
              {
                label: 'Template',
                lang: 'html',
                code: code`
                  <!-- routerLink on Ionic elements: needs RouterLink + IonRouterLink -->
                  <ion-item [routerLink]="['/payments', payment.id]" routerDirection="forward" [detail]="true">
                    <ion-label>{{ payment.concept }}</ion-label>
                  </ion-item>

                  <!-- On <a>: needs RouterLink + IonRouterLinkWithHref -->
                  <a routerLink="/tabs/home" routerDirection="root">Ir al inicio</a>

                  <ion-button routerLink="/login" routerDirection="root" fill="clear">Salir</ion-button>
                `,
              },
              {
                label: 'TypeScript',
                lang: 'ts',
                code: code`
                  import { Component, input } from '@angular/core';
                  import { RouterLink } from '@angular/router';
                  import {
                    IonButton, IonContent, IonItem, IonLabel, IonRouterLink, IonRouterLinkWithHref,
                  } from '@ionic/angular/standalone';

                  @Component({
                    selector: 'app-payment-detail',
                    templateUrl: './payment-detail.page.html',
                    imports: [IonContent, IonItem, IonLabel, IonButton, RouterLink, IonRouterLink, IonRouterLinkWithHref],
                  })
                  export class PaymentDetailPage {
                    // Route param ":id" bound as input (requires withComponentInputBinding())
                    readonly id = input.required<string>();
                  }

                  // main.ts → provideRouter(routes, withPreloading(PreloadAllModules), withComponentInputBinding())
                `,
              },
            ],
          },
          {
            t: 'table',
            title: 'Props de `ion-router-outlet`',
            head: ['Prop', 'Uso'],
            rows: [
              ['`animated`', 'Activa/desactiva animaciones de transición (default `true`).'],
              ['`animation`', 'Función `AnimationBuilder` personalizada.'],
              ['`swipeGesture`', 'Swipe-back en iOS (también configurable globalmente con `swipeBackEnabled`).'],
            ],
          },
        ],
        pitfalls: [
          "Usar `<router-outlet>` en vez de `<ion-router-outlet>`: no hay stack, ni transiciones, ni hooks `ionView*`.",
          "Olvidar importar `IonRouterLink` (o `IonRouterLinkWithHref` para `<a>`): `routerDirection` se ignora y la animación es incorrecta.",
          "Leer `ActivatedRoute.snapshot` en `ngOnInit` de una página cacheada: al volver con otros parámetros no se re-ejecuta. Usa inputs de ruta o el observable `paramMap`.",
        ],
        links: [
          ['Angular Navigation (Ionic)', 'https://ionicframework.com/docs/angular/navigation'],
          ['ion-router-outlet', 'https://ionicframework.com/docs/api/router-outlet'],
        ],
      },
      {
        id: 'tabs',
        title: 'Tabs (`ion-tabs`)',
        tags: ['ion-tabs', 'ion-tab-bar', 'ion-tab-button', 'children routes'],
        summary: "`ion-tabs` crea una navegación por pestañas donde **cada tab tiene su propio stack**. En Angular, cada `ion-tab-button` se enlaza por su atributo `tab` con una ruta hija del mismo nombre.",
        when: [
          "Apps con 3–5 áreas principales de uso frecuente (Inicio, Pagos, Perfil…).",
          "Cuando quieres conservar el estado de navegación de cada área al cambiar de tab.",
        ],
        blocks: [
          {
            t: 'tabs',
            tabs: [
              {
                label: 'Template',
                lang: 'html',
                file: 'tabs.page.html',
                code: code`
                  <ion-tabs>
                    <ion-tab-bar slot="bottom">
                      <ion-tab-button tab="home">
                        <ion-icon name="home-outline" aria-hidden="true"></ion-icon>
                        <ion-label>Inicio</ion-label>
                      </ion-tab-button>
                      <ion-tab-button tab="payments">
                        <ion-icon name="card-outline" aria-hidden="true"></ion-icon>
                        <ion-label>Pagos</ion-label>
                        <ion-badge color="danger">3</ion-badge>
                      </ion-tab-button>
                      <ion-tab-button tab="profile">
                        <ion-icon name="person-outline" aria-hidden="true"></ion-icon>
                        <ion-label>Perfil</ion-label>
                      </ion-tab-button>
                    </ion-tab-bar>
                  </ion-tabs>
                `,
              },
              {
                label: 'TypeScript',
                lang: 'ts',
                file: 'tabs.page.ts',
                code: code`
                  import { Component } from '@angular/core';
                  import { IonBadge, IonIcon, IonLabel, IonTabBar, IonTabButton, IonTabs } from '@ionic/angular/standalone';
                  import { addIcons } from 'ionicons';
                  import { cardOutline, homeOutline, personOutline } from 'ionicons/icons';

                  @Component({
                    selector: 'app-tabs',
                    templateUrl: './tabs.page.html',
                    imports: [IonTabs, IonTabBar, IonTabButton, IonIcon, IonLabel, IonBadge],
                  })
                  export class TabsPage {
                    constructor() {
                      addIcons({ homeOutline, cardOutline, personOutline });
                    }
                  }
                `,
              },
              {
                label: 'Rutas',
                lang: 'ts',
                file: 'tabs.routes.ts',
                code: code`
                  import { Routes } from '@angular/router';
                  import { TabsPage } from './tabs.page';

                  export const TABS_ROUTES: Routes = [
                    {
                      path: '',
                      component: TabsPage,
                      children: [
                        // path must match the "tab" attribute of each ion-tab-button
                        { path: 'home', loadComponent: () => import('../home/home.page').then((m) => m.HomePage) },
                        { path: 'payments', loadComponent: () => import('../payments/payments.page').then((m) => m.PaymentsPage) },
                        { path: 'profile', loadComponent: () => import('../profile/profile.page').then((m) => m.ProfilePage) },
                        { path: '', redirectTo: 'home', pathMatch: 'full' },
                      ],
                    },
                  ];
                `,
              },
            ],
          },
          {
            t: 'table',
            title: 'Cheatsheet',
            head: ['Componente', 'Props / eventos clave'],
            rows: [
              ['`ion-tabs`', 'Eventos `ionTabsWillChange`, `ionTabsDidChange` (`detail.tab`). Métodos `select(tab)`, `getSelected()`.'],
              ['`ion-tab-bar`', '`slot` (`bottom`/`top`), `selectedTab`, `translucent`, `color`.'],
              ['`ion-tab-button`', '`tab` (obligatorio), `disabled`, `layout` (`icon-top`, `icon-start`, `label-hide`…).'],
            ],
          },
        ],
        pitfalls: [
          "El atributo `tab` no coincide con el `path` de la ruta hija: la tab no se activa.",
          "Navegar de una tab a una página de otra tab esperando un back coherente: cada tab tiene su stack; usa rutas compartidas fuera de tabs o `navigateRoot`.",
          "Poner páginas de detalle fuera de `tabs` cuando quieres que se vea la tab bar (o al revés).",
          "Usar `ion-back-button` para volver entre tabs: el back solo recorre el stack de la tab actual.",
        ],
        links: [
          ['ion-tabs', 'https://ionicframework.com/docs/api/tabs'],
          ['Navegación con tabs', 'https://ionicframework.com/docs/angular/navigation#working-with-tabs'],
        ],
      },
      {
        id: 'menu',
        title: 'Menú lateral (`ion-menu`) y `ion-split-pane`',
        tags: ['ion-menu', 'ion-menu-button', 'ion-menu-toggle', 'MenuController', 'ion-split-pane', 'contentId'],
        summary: "`ion-menu` es un panel lateral que se abre con gesto o botón. Con `ion-split-pane` el menú queda fijo a partir de un breakpoint (desktop/tablet).",
        when: [
          "Apps con muchas secciones o perfiles que no caben en una tab bar.",
          "Apps que también se usan en desktop: el menú fijo con split-pane da una experiencia tipo panel de administración.",
        ],
        blocks: [
          {
            t: 'tabs',
            tabs: [
              {
                label: 'Template',
                lang: 'html',
                file: 'app.component.html',
                code: code`
                  <ion-app>
                    <ion-split-pane contentId="main-content" when="md">
                      <ion-menu contentId="main-content" menuId="main" type="overlay">
                        <ion-header>
                          <ion-toolbar><ion-title>Menú</ion-title></ion-toolbar>
                        </ion-header>
                        <ion-content>
                          <ion-list>
                            @for (p of pages; track p.url) {
                              <ion-menu-toggle [autoHide]="false">
                                <ion-item [routerLink]="p.url" routerDirection="root" routerLinkActive="selected" lines="none" [detail]="false">
                                  <ion-icon slot="start" [name]="p.icon" aria-hidden="true"></ion-icon>
                                  <ion-label>{{ p.title }}</ion-label>
                                </ion-item>
                              </ion-menu-toggle>
                            }
                          </ion-list>
                        </ion-content>
                      </ion-menu>

                      <ion-router-outlet id="main-content"></ion-router-outlet>
                    </ion-split-pane>
                  </ion-app>

                  <!-- In each page toolbar -->
                  <!-- <ion-buttons slot="start"><ion-menu-button></ion-menu-button></ion-buttons> -->
                `,
              },
              {
                label: 'TypeScript',
                lang: 'ts',
                code: code`
                  import { Component, inject } from '@angular/core';
                  import { RouterLink, RouterLinkActive } from '@angular/router';
                  import {
                    IonApp, IonContent, IonHeader, IonIcon, IonItem, IonLabel, IonList, IonMenu, IonMenuToggle,
                    IonRouterLink, IonRouterOutlet, IonSplitPane, IonTitle, IonToolbar, MenuController,
                  } from '@ionic/angular/standalone';

                  @Component({
                    selector: 'app-root',
                    templateUrl: 'app.component.html',
                    imports: [
                      IonApp, IonSplitPane, IonMenu, IonHeader, IonToolbar, IonTitle, IonContent, IonList,
                      IonMenuToggle, IonItem, IonIcon, IonLabel, IonRouterOutlet, RouterLink, RouterLinkActive, IonRouterLink,
                    ],
                  })
                  export class AppComponent {
                    private readonly menuCtrl = inject(MenuController);

                    readonly pages = [
                      { title: 'Inicio', url: '/home', icon: 'home-outline' },
                      { title: 'Pagos', url: '/payments', icon: 'card-outline' },
                    ];

                    // e.g. call from the login page: disable the menu (and its swipe gesture)
                    async setMenuEnabled(enabled: boolean): Promise<void> {
                      await this.menuCtrl.enable(enabled, 'main');
                    }
                  }
                `,
              },
            ],
          },
          {
            t: 'table',
            title: 'Cheatsheet',
            head: ['Elemento', 'Props / métodos clave'],
            rows: [
              ['`ion-menu`', '`contentId`, `menuId`, `side` (`start`/`end`), `type` (`overlay`/`reveal`/`push`), `swipeGesture`, `disabled`. Eventos `ionWillOpen`, `ionDidClose`…'],
              ['`ion-menu-button`', '`menu` (id), `autoHide`. Se oculta solo cuando el menú no está disponible.'],
              ['`ion-menu-toggle`', '`menu`, `autoHide`. Cierra el menú al pulsar el contenido.'],
              ['`ion-split-pane`', '`contentId`, `when` (`xs`…`xl`, media query o boolean), `disabled`.'],
              ['`MenuController`', '`open(id?)`, `close(id?)`, `toggle(id?)`, `enable(bool, id?)`, `isOpen(id?)`.'],
            ],
          },
        ],
        pitfalls: [
          "`contentId` del menú no coincide con el `id` del outlet: el menú no aparece o tapa todo.",
          "Menú accesible por gesto en la pantalla de login: desactívalo con `menuCtrl.enable(false, 'main')`.",
          "Importar `MenuController` desde `@ionic/angular` en una app standalone.",
        ],
        links: [
          ['ion-menu', 'https://ionicframework.com/docs/api/menu'],
          ['ion-split-pane', 'https://ionicframework.com/docs/api/split-pane'],
        ],
      },
      {
        id: 'navcontroller-vs-router',
        title: '`NavController` frente a `Router`',
        tags: ['NavController', 'navigateForward', 'navigateBack', 'navigateRoot', 'Router', 'replaceUrl'],
        summary: "`NavController` es un envoltorio sobre el `Router` de Angular que además fija la **dirección** de la animación y la manipulación del stack. `Router.navigate` funciona, pero Ionic infiere la dirección.",
        when: [
          "`navigateRoot` tras login/logout: limpia el stack para que el back no vuelva a la pantalla anterior.",
          "`navigateBack` cuando navegas \"hacia atrás\" a una ruta concreta (animación de retroceso).",
          "`Router` para el resto de casos, guards y navegación desde servicios genéricos.",
        ],
        blocks: [
          {
            t: 'code',
            lang: 'ts',
            code: code`
              import { Injectable, inject } from '@angular/core';
              import { Router } from '@angular/router';
              import { NavController } from '@ionic/angular/standalone';

              @Injectable({ providedIn: 'root' })
              export class NavigationService {
                private readonly nav = inject(NavController);
                private readonly router = inject(Router);

                openPayment(id: string): Promise<boolean> {
                  return this.nav.navigateForward(['/payments', id], { queryParams: { from: 'list' } });
                }

                afterLogin(): Promise<boolean> {
                  // Clears the page stack: hardware back will not return to login
                  return this.nav.navigateRoot('/tabs/home', { animationDirection: 'forward' });
                }

                backToList(): Promise<boolean> {
                  return this.nav.navigateBack('/tabs/payments');
                }

                goBack(): void {
                  this.nav.back(); // like ion-back-button
                }

                // Plain Angular Router (Ionic infers the direction)
                logout(): Promise<boolean> {
                  return this.router.navigate(['/login'], { replaceUrl: true });
                }
              }
            `,
          },
          {
            t: 'table',
            head: ['Método', 'Animación', 'Stack'],
            rows: [
              ['`navigateForward(url)`', 'Forward (push)', 'Añade la página.'],
              ['`navigateBack(url)`', 'Back (pop)', 'Vuelve/retrocede a la ruta.'],
              ['`navigateRoot(url)`', 'Root (sin back)', 'Reinicia el stack.'],
              ['`back()`', 'Back', 'Vuelve a la página anterior del stack.'],
              ['`pop()`', 'Back', 'Saca la página actual del outlet.'],
              ['`setDirection(dir)`', '—', 'Fija la dirección para la próxima navegación del Router.'],
              ['`router.navigate(url)`', 'Inferida', 'Según historial.'],
            ],
          },
        ],
        pitfalls: [
          "Usar `navigateForward` al login tras logout: el usuario puede volver con back a páginas privadas.",
          "Llamar a `window.history.back()`: rompe la sincronización del stack de Ionic.",
          "Mezclar `[routerLink]` sin `routerDirection` y esperar animación de retroceso.",
        ],
        links: [['NavController', 'https://ionicframework.com/docs/angular/navigation']],
      },
      {
        id: 'stack-paginas',
        title: 'Stack de páginas y `ion-back-button`',
        tags: ['stack', 'cache', 'ion-back-button', 'defaultHref', 'swipe back', 'canGoBack'],
        summary: "Al navegar hacia adelante, `ion-router-outlet` **no destruye** la página anterior: la oculta y la mantiene en el DOM. Al volver, la página que se abandona sí se destruye. Esto permite volver al estado anterior (scroll incluido) sin recargar.",
        when: [
          "Para entender por qué `ngOnInit`/`ngOnDestroy` no se ejecutan cuando esperas (ver [Cache de páginas](#/ciclo-vida/cache-paginas)).",
          "Al añadir el botón atrás en el header.",
        ],
        blocks: [
          {
            t: 'code',
            lang: 'html',
            code: code`
              <ion-header>
                <ion-toolbar>
                  <ion-buttons slot="start">
                    <!-- defaultHref is used when there is no history (deep link, page reload) -->
                    <ion-back-button defaultHref="/tabs/payments" text="Pagos"></ion-back-button>
                  </ion-buttons>
                  <ion-title>Detalle</ion-title>
                </ion-toolbar>
              </ion-header>
            `,
          },
          {
            t: 'code',
            lang: 'text',
            title: 'Qué pasa con el stack',
            code: code`
              navigateForward A → B → C     stack: [A, B, C]    A and B hidden, still alive
              back from C                   stack: [A, B]       C destroyed (ngOnDestroy)
              navigateRoot D                stack: [D]          A and B destroyed
            `,
          },
          {
            t: 'code',
            lang: 'ts',
            title: 'Desactivar swipe-back global o por outlet',
            code: code`
              provideIonicAngular({ swipeBackEnabled: false });
              // or per outlet: <ion-router-outlet [swipeGesture]="false"></ion-router-outlet>
            `,
          },
        ],
        pitfalls: [
          "Stacks muy profundos (navegar forward en bucle a la misma ruta): consumo de memoria creciente. Usa `navigateBack`/`navigateRoot` cuando corresponda.",
          "Sin `defaultHref`, el back button no aparece al abrir la página por deep link.",
          "Formularios que quedan con datos al volver: resetea en `ionViewWillEnter` o al guardar.",
        ],
        links: [
          ['ion-back-button', 'https://ionicframework.com/docs/api/back-button'],
          ['Navegación lineal y no lineal', 'https://ionicframework.com/docs/angular/navigation'],
        ],
      },
      {
        id: 'back-button-android',
        title: 'Botón atrás de Android (hardware back)',
        tags: ['backButton', 'subscribeWithPriority', 'App.exitApp', 'canGoBack', '@capacitor/app'],
        summary: "Ionic gestiona el back de Android con prioridades: overlays (100), menú (99) y navegación (0). Puedes registrar handlers propios con `platform.backButton.subscribeWithPriority`. En apps Capacitor requiere `@capacitor/app` instalado.",
        when: [
          "Salir de la app al pulsar back en la página raíz.",
          "Interceptar back en un flujo (p. ej. pedir confirmación antes de abandonar un pago).",
        ],
        blocks: [
          {
            t: 'code',
            lang: 'ts',
            file: 'app.component.ts',
            code: code`
              import { Component, inject } from '@angular/core';
              import { App } from '@capacitor/app';
              import { IonApp, IonRouterOutlet, Platform } from '@ionic/angular/standalone';

              @Component({
                selector: 'app-root',
                template: '<ion-app><ion-router-outlet></ion-router-outlet></ion-app>',
                imports: [IonApp, IonRouterOutlet],
              })
              export class AppComponent {
                private readonly platform = inject(Platform);
                private readonly routerOutlet = inject(IonRouterOutlet, { optional: true });

                constructor() {
                  // Priority -1: runs only if nothing else (overlays 100, menu 99, navigation 0) handled it
                  this.platform.backButton.subscribeWithPriority(-1, () => {
                    if (!this.routerOutlet?.canGoBack()) {
                      void App.exitApp();
                    }
                  });
                }
              }
            `,
          },
          {
            t: 'code',
            lang: 'ts',
            title: 'Confirmar antes de salir de una página (prioridad alta)',
            code: code`
              // Inside a page: register on enter, unsubscribe on leave (page may be cached)
              private backSub?: { unsubscribe(): void };

              ionViewDidEnter(): void {
                this.backSub = this.platform.backButton.subscribeWithPriority(101, async () => {
                  if (await this.confirmLeave()) this.nav.back();
                });
              }

              ionViewWillLeave(): void {
                this.backSub?.unsubscribe();
              }
            `,
          },
          {
            t: 'table',
            head: ['Prioridad', 'Quién la usa'],
            rows: [
              ['100', 'Overlays (modal, alert, action sheet, popover…): los cierra.'],
              ['99', 'Menú: lo cierra si está abierto.'],
              ['0', 'Navegación: vuelve atrás en el stack.'],
              ['< 0', 'Tus handlers de \"último recurso\" (salir de la app).'],
            ],
          },
        ],
        pitfalls: [
          "Registrar también `App.addListener('backButton', …)` de Capacitor: compite con el sistema de Ionic y puedes tener doble navegación.",
          "Suscribirse en `ngOnInit` de una página cacheada sin desuscribirse: el handler sigue activo en otras páginas.",
          "`App.exitApp()` en iOS: no aplica (Apple no permite cerrar la app programáticamente).",
          "Desactivar con `provideIonicAngular({ hardwareBackButton: false })` y olvidar que entonces nada responde al back.",
        ],
        links: [
          ['Hardware Back Button', 'https://ionicframework.com/docs/developing/hardware-back-button'],
          ['@capacitor/app', 'https://capacitorjs.com/docs/apis/app'],
        ],
      },
    ],
  },

  /* ===================================================================
     4. CICLO DE VIDA
     =================================================================== */
  {
    id: 'ciclo-vida',
    num: 4,
    title: 'Ciclo de vida de páginas',
    desc: "`ionViewWillEnter` / `DidEnter` / `WillLeave` / `DidLeave` frente a los hooks de Angular, y por qué importan con el cache de páginas.",
    topics: [
      {
        id: 'ionic-hooks',
        title: 'Hooks de Ionic: `ionViewWillEnter`, `DidEnter`, `WillLeave`, `DidLeave`',
        tags: ['ionViewWillEnter', 'ionViewDidEnter', 'ionViewWillLeave', 'ionViewDidLeave', 'ViewWillEnter'],
        summary: "Ionic añade 4 hooks que se disparan **cada vez** que una página entra o sale de la vista, aunque esté cacheada. Solo se llaman en componentes asociados directamente a una ruta.",
        when: [
          "Refrescar datos cada vez que el usuario vuelve a la página.",
          "Arrancar/parar recursos ligados a la visibilidad (timers, listeners, cámara, back button).",
        ],
        blocks: [
          {
            t: 'table',
            head: ['Hook', 'Cuándo', 'Úsalo para'],
            rows: [
              ['`ionViewWillEnter`', 'Antes de la animación de entrada.', 'Cargar/refrescar datos, resetear formularios.'],
              ['`ionViewDidEnter`', 'Al terminar la animación de entrada.', 'Trabajo pesado (mapas, gráficas), foco, analytics.'],
              ['`ionViewWillLeave`', 'Antes de la animación de salida.', 'Pausar timers, desuscribir listeners de visibilidad.'],
              ['`ionViewDidLeave`', 'Al terminar la salida.', 'Liberar recursos de la vista anterior.'],
            ],
          },
          {
            t: 'code',
            lang: 'ts',
            code: code`
              import { Component, inject, signal } from '@angular/core';
              import { IonContent, IonHeader, IonTitle, IonToolbar } from '@ionic/angular/standalone';
              import { PaymentService, Payment } from '../../core/services/payment.service';

              @Component({
                selector: 'app-payments',
                templateUrl: './payments.page.html',
                imports: [IonHeader, IonToolbar, IonTitle, IonContent],
              })
              export class PaymentsPage {
                private readonly api = inject(PaymentService);
                readonly payments = signal<Payment[]>([]);
                private poll?: ReturnType<typeof setInterval>;

                ionViewWillEnter(): void {
                  void this.load(); // runs on every visit, even if the page is cached
                }

                ionViewDidEnter(): void {
                  this.poll = setInterval(() => void this.load(), 30_000);
                }

                ionViewWillLeave(): void {
                  clearInterval(this.poll);
                }

                private async load(): Promise<void> {
                  const res = await this.api.listAsync(); // ServiceResult<Page<Payment>>
                  if (res.ok && res.data) this.payments.set(res.data.items);
                }
              }
            `,
          },
          {
            t: 'note',
            kind: 'info',
            text: "Existen interfaces tipadas (`ViewWillEnter`, `ViewDidEnter`, `ViewWillLeave`, `ViewDidLeave`) exportadas por `@ionic/angular` ⚠ verificar si también se exportan desde `@ionic/angular/standalone` en tu versión. Implementar los métodos sin la interfaz funciona igual.",
          },
        ],
        pitfalls: [
          "Esperar estos hooks en un componente hijo (no enrutado): no se llaman. Pasa el evento desde la página o usa un servicio.",
          "Hacer peticiones pesadas en `ionViewWillEnter` que bloquean la animación: muestra skeleton y carga, o usa `DidEnter`.",
          "Hooks en componentes abiertos en un modal: no se disparan; usa los eventos del modal.",
        ],
        links: [['Ciclo de vida (Angular)', 'https://ionicframework.com/docs/angular/lifecycle']],
      },
      {
        id: 'angular-vs-ionic',
        title: 'Orden de ejecución: hooks de Angular frente a hooks de Ionic',
        tags: ['ngOnInit', 'ngOnDestroy', 'orden', 'lifecycle'],
        summary: "`ngOnInit` se ejecuta **una vez** al crear la página; `ngOnDestroy` solo cuando la página se saca del stack. Los hooks `ionView*` se ejecutan en cada entrada/salida.",
        when: [
          "Para decidir dónde poner cada lógica de inicialización y limpieza.",
        ],
        blocks: [
          {
            t: 'code',
            lang: 'text',
            title: 'Secuencias típicas',
            code: code`
              1) First visit to page A
                 constructor → ngOnInit → ionViewWillEnter → ionViewDidEnter

              2) Navigate forward A → B   (A stays cached)
                 A.ionViewWillLeave → B.(constructor, ngOnInit) → B.ionViewWillEnter
                 → A.ionViewDidLeave → B.ionViewDidEnter            (no A.ngOnDestroy!)

              3) Back B → A
                 B.ionViewWillLeave → A.ionViewWillEnter → B.ionViewDidLeave
                 → A.ionViewDidEnter → B.ngOnDestroy               (no A.ngOnInit!)
            `,
          },
          {
            t: 'table',
            head: ['Lógica', 'Dónde'],
            rows: [
              ['Inyección, configurar formularios, suscripciones de por vida', '`constructor` / `ngOnInit`'],
              ['Refrescar datos al volver', '`ionViewWillEnter`'],
              ['Inicializar librerías que necesitan tamaño real del DOM', '`ionViewDidEnter`'],
              ['Pausar recursos mientras la página no se ve', '`ionViewWillLeave`'],
              ['Liberar todo definitivamente', '`ngOnDestroy` / `DestroyRef` / `takeUntilDestroyed`'],
            ],
          },
        ],
        pitfalls: [
          "Cargar datos solo en `ngOnInit`: al volver de editar un pago, la lista muestra datos viejos.",
          "Confiar en `ngOnDestroy` para parar un timer cuando navegas forward: el timer sigue en segundo plano.",
        ],
        links: [['Ciclo de vida (Angular)', 'https://ionicframework.com/docs/angular/lifecycle']],
      },
      {
        id: 'cache-paginas',
        title: 'Cache de páginas: por qué importa',
        tags: ['cache', 'IonicRouteStrategy', 'suscripciones', 'memory leaks', 'estado'],
        summary: "Las páginas anteriores del stack siguen vivas y suscritas. Esto conserva estado y scroll, pero cualquier suscripción, listener o timer sigue corriendo mientras la página no se ve.",
        when: [
          "Al revisar fugas de memoria, llamadas HTTP duplicadas o listeners que se ejecutan varias veces.",
          "Al decidir dónde guardar el estado (página vs servicio con signals).",
        ],
        blocks: [
          {
            t: 'code',
            lang: 'ts',
            title: 'Patrón: suscripción solo mientras la página está visible',
            code: code`
              import { Component, inject } from '@angular/core';
              import { Subscription } from 'rxjs';
              import { Network } from '@capacitor/network';
              import type { PluginListenerHandle } from '@capacitor/core';
              import { RealtimeService } from '../../core/services/realtime.service';

              @Component({ selector: 'app-dashboard', templateUrl: './dashboard.page.html', imports: [] })
              export class DashboardPage {
                private readonly realtime = inject(RealtimeService);
                private sub?: Subscription;
                private netHandle?: PluginListenerHandle;

                async ionViewWillEnter(): Promise<void> {
                  this.sub = this.realtime.balance$.subscribe((b) => this.render(b));
                  this.netHandle = await Network.addListener('networkStatusChange', (s) => this.onNetwork(s.connected));
                }

                ionViewWillLeave(): void {
                  this.sub?.unsubscribe();
                  void this.netHandle?.remove();
                }

                private render(balance: number): void { /* ... */ }
                private onNetwork(connected: boolean): void { /* ... */ }
              }
            `,
          },
          {
            t: 'note',
            kind: 'ok',
            text: "Con **signals** en un servicio `providedIn: 'root'` y `async` pipe/plantilla reactiva, la página cacheada se actualiza sola al volver, y las suscripciones del template se limpian al destruirse.",
          },
        ],
        pitfalls: [
          "Listeners de Capacitor añadidos en `ionViewWillEnter` y nunca eliminados: se acumulan en cada visita.",
          "Quitar `IonicRouteStrategy` para \"evitar\" el cache: rompe el stack y las transiciones.",
        ],
        links: [['Ciclo de vida (Angular)', 'https://ionicframework.com/docs/angular/lifecycle']],
      },
      {
        id: 'hooks-tabs-modales',
        title: 'Ciclo de vida en tabs y modales',
        tags: ['tabs', 'modal', 'willPresent', 'didDismiss', 'ionModalDidPresent'],
        summary: "En tabs, cada página de tab recibe `ionViewWillEnter`/`WillLeave` al cambiar de pestaña. En modales los hooks `ionView*` **no** se disparan: usa los eventos del propio modal.",
        when: [
          "Refrescar una tab cada vez que se selecciona.",
          "Inicializar/limpiar un componente abierto en un modal.",
        ],
        blocks: [
          {
            t: 'tabs',
            tabs: [
              {
                label: 'Template',
                lang: 'html',
                code: code`
                  <!-- Inline modal: lifecycle via events -->
                  <ion-modal [isOpen]="open()" (willPresent)="onWillPresent()" (didDismiss)="open.set(false)">
                    <ng-template>
                      <app-card-scanner></app-card-scanner>
                    </ng-template>
                  </ion-modal>
                `,
              },
              {
                label: 'TypeScript',
                lang: 'ts',
                code: code`
                  // Controller modal: lifecycle via promises
                  const modal = await this.modalCtrl.create({ component: CardScannerComponent });
                  await modal.present();          // ~ didPresent
                  const { data, role } = await modal.onWillDismiss();
                  await modal.onDidDismiss();     // ~ didDismiss

                  // Inside the modal component itself, use ngOnInit / ngOnDestroy
                `,
              },
            ],
          },
        ],
        pitfalls: [
          "Implementar `ionViewWillEnter` dentro del componente del modal: nunca se ejecuta.",
          "Esperar `ngOnInit` en una tab al volver a ella: solo ocurre la primera vez.",
        ],
        links: [
          ['ion-modal (eventos)', 'https://ionicframework.com/docs/api/modal#events'],
          ['Ciclo de vida', 'https://ionicframework.com/docs/angular/lifecycle'],
        ],
      },
    ],
  },

  /* ===================================================================
     5. COMPONENTES UI
     =================================================================== */
  {
    id: 'componentes',
    num: 5,
    title: 'Componentes UI',
    desc: "Layout, grid, listas, cards, botones, inputs, selects, toggles, segment, searchbar, infinite scroll, refresher, skeleton y virtual scroll — con cheatsheets de props y eventos.",
    topics: [
      {
        id: 'layout',
        title: 'Layout: `ion-header`, `ion-toolbar`, `ion-content`, `ion-footer`',
        tags: ['ion-header', 'ion-toolbar', 'ion-buttons', 'ion-content', 'ion-footer', 'collapse', 'fullscreen'],
        summary: "Cada página es `ion-header` + `ion-content` (+ `ion-footer` opcional). `ion-content` es el contenedor con scroll y gestiona safe areas, teclado y eventos de scroll.",
        when: ["En toda página. Es la estructura base de cualquier vista Ionic."],
        blocks: [
          {
            t: 'code',
            lang: 'html',
            code: code`
              <ion-header [translucent]="true">
                <ion-toolbar color="primary">
                  <ion-buttons slot="start">
                    <ion-back-button defaultHref="/tabs/home"></ion-back-button>
                  </ion-buttons>
                  <ion-title>Pagos</ion-title>
                  <ion-buttons slot="end">
                    <ion-button (click)="refresh()" aria-label="Actualizar">
                      <ion-icon slot="icon-only" name="refresh-outline"></ion-icon>
                    </ion-button>
                  </ion-buttons>
                </ion-toolbar>
              </ion-header>

              <ion-content [fullscreen]="true" class="ion-padding" [scrollEvents]="true" (ionScroll)="onScroll($event)">
                <!-- iOS large title that collapses into the toolbar -->
                <ion-header collapse="condense">
                  <ion-toolbar><ion-title size="large">Pagos</ion-title></ion-toolbar>
                </ion-header>
                ...
              </ion-content>

              <ion-footer>
                <ion-toolbar>
                  <ion-button expand="block" (click)="pay()">Pagar</ion-button>
                </ion-toolbar>
              </ion-footer>
            `,
          },
          {
            t: 'table',
            title: 'Cheatsheet',
            head: ['Componente', 'Props / métodos / eventos clave'],
            rows: [
              ['`ion-header`', '`translucent`, `collapse` (`condense` iOS, `fade`).'],
              ['`ion-toolbar`', '`color`. Slots en `ion-buttons`: `start`, `end`, `primary`, `secondary`.'],
              ['`ion-title`', '`size` (`large` para título grande iOS).'],
              ['`ion-content`', '`fullscreen`, `scrollY`, `scrollX`, `scrollEvents`, `forceOverscroll`, `color`. Métodos `scrollToTop(ms)`, `scrollToBottom(ms)`, `scrollToPoint(x,y,ms)`, `getScrollElement()`. Eventos `ionScrollStart`, `ionScroll`, `ionScrollEnd` (requieren `scrollEvents`).'],
              ['`ion-footer`', '`translucent`, `collapse` (`fade`).'],
            ],
          },
        ],
        pitfalls: [
          "Poner `ion-header` dentro de `ion-content` (salvo el `collapse=\"condense\"`): el header hace scroll con el contenido.",
          "Usar `overflow: auto` en divs internos en lugar del scroll de `ion-content`: rompe refresher, infinite scroll y teclado.",
          "Esperar `ionScroll` sin `[scrollEvents]=\"true\"`.",
        ],
        links: [
          ['ion-content', 'https://ionicframework.com/docs/api/content'],
          ['ion-toolbar', 'https://ionicframework.com/docs/api/toolbar'],
        ],
      },
      {
        id: 'grid',
        title: 'Grid responsive (`ion-grid`, `ion-row`, `ion-col`)',
        tags: ['ion-grid', 'ion-row', 'ion-col', 'size-md', 'offset', 'breakpoints'],
        summary: "Grid flexbox de 12 columnas con tamaños por breakpoint (`size`, `size-sm`, `size-md`, `size-lg`, `size-xl`).",
        when: [
          "Formularios a 1 columna en móvil y 2 en desktop.",
          "Dashboards de cards adaptables.",
        ],
        blocks: [
          {
            t: 'code',
            lang: 'html',
            code: code`
              <ion-grid [fixed]="true">
                <ion-row>
                  <ion-col size="12" size-md="6">
                    <ion-card>…</ion-card>
                  </ion-col>
                  <ion-col size="12" size-md="6">
                    <ion-card>…</ion-card>
                  </ion-col>
                </ion-row>
                <ion-row class="ion-justify-content-center">
                  <ion-col size="12" size-md="8" size-lg="6">
                    <ion-button expand="block">Continuar</ion-button>
                  </ion-col>
                </ion-row>
              </ion-grid>
            `,
          },
          {
            t: 'table',
            title: 'Breakpoints por defecto',
            head: ['Nombre', 'Desde', 'Ejemplo de uso'],
            rows: [
              ['`xs`', '0px', '`size="12"`'],
              ['`sm`', '576px', '`size-sm="6"`'],
              ['`md`', '768px', '`size-md="6"`, `ion-split-pane when="md"`'],
              ['`lg`', '992px', '`size-lg="4"`'],
              ['`xl`', '1200px', '`size-xl="3"`'],
            ],
          },
          {
            t: 'table',
            title: 'Props',
            head: ['Elemento', 'Props'],
            rows: [
              ['`ion-grid`', '`fixed` (ancho máximo por breakpoint).'],
              ['`ion-col`', '`size[-bp]` (1–12 o `auto`), `offset[-bp]`, `push[-bp]`, `pull[-bp]`.'],
              ['Clases en `ion-row`', '`ion-justify-content-*`, `ion-align-items-*`, `ion-nowrap`, `ion-wrap`.'],
            ],
          },
        ],
        pitfalls: [
          "Olvidar `size=\"12\"` base: en móvil las columnas se reparten y quedan estrechas.",
          "Anidar grids innecesariamente; para layouts complejos, CSS Grid propio en SCSS es más simple.",
        ],
        links: [['ion-grid', 'https://ionicframework.com/docs/api/grid']],
      },
      {
        id: 'listas',
        title: 'Listas e items (`ion-list`, `ion-item`, sliding, reorder)',
        tags: ['ion-list', 'ion-item', 'ion-label', 'ion-note', 'ion-item-sliding', 'ion-reorder-group', 'ion-avatar'],
        summary: "`ion-list` agrupa `ion-item`s con estilo de plataforma. `ion-item-sliding` añade acciones al deslizar; `ion-reorder-group` permite reordenar.",
        when: ["Listados de pagos, contactos, ajustes; menús de opciones; formularios estilo lista."],
        blocks: [
          {
            t: 'code',
            lang: 'html',
            code: code`
              <ion-list [inset]="true" lines="full">
                <ion-list-header>
                  <ion-label>Movimientos</ion-label>
                </ion-list-header>

                @for (p of payments(); track p.id) {
                  <ion-item-sliding #sliding>
                    <ion-item [button]="true" [detail]="true" (click)="open(p)">
                      <ion-avatar slot="start">
                        <img [src]="p.logoUrl" alt="" />
                      </ion-avatar>
                      <ion-label>
                        <h2>{{ p.merchant }}</h2>
                        <p>{{ p.date | date: 'short' }}</p>
                      </ion-label>
                      <ion-note slot="end" [color]="p.amount < 0 ? 'danger' : 'success'">
                        {{ p.amount | currency }}
                      </ion-note>
                    </ion-item>
                    <ion-item-options side="end">
                      <ion-item-option color="danger" (click)="remove(p); sliding.close()">Eliminar</ion-item-option>
                    </ion-item-options>
                  </ion-item-sliding>
                } @empty {
                  <ion-item><ion-label>Sin movimientos</ion-label></ion-item>
                }
              </ion-list>
            `,
          },
          {
            t: 'table',
            title: 'Cheatsheet',
            head: ['Componente', 'Props / eventos clave'],
            rows: [
              ['`ion-list`', '`inset`, `lines` (`full`/`inset`/`none`). Método `closeSlidingItems()`.'],
              ['`ion-item`', '`button`, `detail`, `lines`, `color`, `disabled`, `href`, `routerLink`, `routerDirection`. Slots `start`/`end`.'],
              ['`ion-label`', '`position` solo para casos legacy; con inputs modernos usa `label` del input.'],
              ['`ion-item-sliding`', 'Métodos `open(side)`, `close()`, `getSlidingRatio()`. Evento `ionDrag`.'],
              ['`ion-item-option`', '`color`, `expandable`, `disabled`. Dentro de `ion-item-options` con `side`.'],
              ['`ion-reorder-group`', '`disabled`. Evento `ionItemReorder` → `ev.detail.complete(array?)` ⚠ verificar (Ionic 8 recientes añaden `ionReorderEnd`).'],
              ['Otros', '`ion-list-header`, `ion-item-divider`, `ion-item-group`, `ion-avatar`, `ion-thumbnail`, `ion-note`, `ion-badge`.'],
            ],
          },
        ],
        pitfalls: [
          "Olvidar `[button]=\"true\"` en items clicables: no hay feedback visual ni semántica de botón.",
          "No llamar `complete()` en el evento de reorder: el item queda flotando.",
          "No cerrar el sliding tras ejecutar la acción.",
        ],
        links: [
          ['ion-list', 'https://ionicframework.com/docs/api/list'],
          ['ion-item', 'https://ionicframework.com/docs/api/item'],
          ['ion-item-sliding', 'https://ionicframework.com/docs/api/item-sliding'],
          ['ion-reorder-group', 'https://ionicframework.com/docs/api/reorder-group'],
        ],
      },
      {
        id: 'cards',
        title: 'Cards (`ion-card`)',
        tags: ['ion-card', 'ion-card-header', 'ion-card-title', 'ion-card-subtitle', 'ion-card-content'],
        summary: "Contenedor con elevación para agrupar información. Puede ser clicable (`button`) o enlazar con `routerLink`.",
        when: ["Resúmenes (saldo, tarjeta, última transacción), dashboards, contenido destacado."],
        blocks: [
          {
            t: 'code',
            lang: 'html',
            code: code`
              <ion-card [button]="true" [routerLink]="['/cards', card.id]">
                <ion-card-header>
                  <ion-card-subtitle>Visa ···· {{ card.last4 }}</ion-card-subtitle>
                  <ion-card-title>{{ card.balance | currency: 'USD' }}</ion-card-title>
                </ion-card-header>
                <ion-card-content>
                  Vence {{ card.expMonth }}/{{ card.expYear }}
                </ion-card-content>
                <ion-button fill="clear" (click)="$event.stopPropagation(); freeze(card)">Bloquear</ion-button>
              </ion-card>
            `,
          },
          {
            t: 'table',
            head: ['Prop', 'Uso'],
            rows: [
              ['`button`', 'Hace la card clicable (ripple + foco).'],
              ['`href` / `routerLink` / `routerDirection`', 'Navegación.'],
              ['`color`', 'Color de la paleta.'],
              ['`disabled`', 'Deshabilita la interacción.'],
            ],
          },
        ],
        pitfalls: [
          "Botones dentro de una card clicable sin `stopPropagation`: dispara las dos acciones.",
          "Cards con márgenes por defecto dentro de un grid: ajusta `margin` o usa `ion-padding` coherente.",
        ],
        links: [['ion-card', 'https://ionicframework.com/docs/api/card']],
      },
      {
        id: 'botones',
        title: 'Botones, iconos y FAB',
        tags: ['ion-button', 'expand', 'fill', 'shape', 'ion-icon', 'ion-fab', 'icon-only'],
        summary: "`ion-button` con variantes de relleno, tamaño y forma; `ion-icon` (Ionicons) y `ion-fab` para la acción principal flotante.",
        when: ["Acciones primarias/secundarias, toolbars, acción flotante principal."],
        blocks: [
          {
            t: 'code',
            lang: 'html',
            code: code`
              <ion-button expand="block" type="submit" [disabled]="form.invalid || saving()">Pagar</ion-button>
              <ion-button fill="outline" color="medium">Cancelar</ion-button>
              <ion-button fill="clear" size="small">
                <ion-icon slot="start" name="download-outline"></ion-icon>
                Descargar
              </ion-button>
              <ion-button shape="round" aria-label="Favorito">
                <ion-icon slot="icon-only" name="star"></ion-icon>
              </ion-button>

              <ion-fab slot="fixed" vertical="bottom" horizontal="end">
                <ion-fab-button aria-label="Nuevo pago" (click)="newPayment()">
                  <ion-icon name="add"></ion-icon>
                </ion-fab-button>
              </ion-fab>
            `,
          },
          {
            t: 'table',
            title: 'Cheatsheet',
            head: ['Componente', 'Props clave'],
            rows: [
              ['`ion-button`', '`expand` (`block`/`full`), `fill` (`solid`/`outline`/`clear`/`default`), `shape` (`round`), `size` (`small`/`default`/`large`), `color`, `strong`, `disabled`, `type`, `href`, `routerLink`. Slots `start`, `end`, `icon-only`.'],
              ['`ion-icon`', '`name`, `icon` (objeto importado), `size` (`small`/`large`), `color`, `aria-hidden`/`aria-label`.'],
              ['`ion-fab`', '`slot=\"fixed\"`, `vertical`, `horizontal`, `edge`, `activated`.'],
              ['`ion-fab-button`', '`size` (`small`), `color`, `closeIcon`.'],
            ],
          },
        ],
        pitfalls: [
          "Botón solo icono sin `aria-label`: inaccesible para lectores de pantalla.",
          "`ion-fab` sin `slot=\"fixed\"`: hace scroll con el contenido.",
          "Iconos que no aparecen en standalone: falta registrarlos con `addIcons`.",
        ],
        links: [
          ['ion-button', 'https://ionicframework.com/docs/api/button'],
          ['ion-fab', 'https://ionicframework.com/docs/api/fab'],
          ['Ionicons', 'https://ionic.io/ionicons'],
        ],
      },
      {
        id: 'inputs',
        title: 'Inputs (`ion-input`, `ion-textarea`)',
        tags: ['ion-input', 'label', 'labelPlacement', 'fill', 'errorText', 'helperText', 'counter', 'ion-input-password-toggle', 'ion-textarea'],
        summary: "Desde Ionic 7 el label va en el propio input (`label` + `labelPlacement`), con `helperText`/`errorText` y `counter` integrados. Se integra con Reactive Forms vía `formControlName`.",
        when: ["Cualquier entrada de texto, número, email, contraseña o importe."],
        blocks: [
          {
            t: 'tabs',
            tabs: [
              {
                label: 'Template',
                lang: 'html',
                code: code`
                  <ion-input
                    label="Correo"
                    labelPlacement="floating"
                    fill="outline"
                    type="email"
                    inputmode="email"
                    autocomplete="email"
                    formControlName="email"
                    helperText="Te enviaremos el comprobante"
                    errorText="Correo no válido"
                    [clearInput]="true"
                  ></ion-input>

                  <ion-input label="Contraseña" labelPlacement="floating" fill="outline" type="password" formControlName="password">
                    <ion-input-password-toggle slot="end"></ion-input-password-toggle>
                  </ion-input>

                  <ion-textarea
                    label="Comentario"
                    labelPlacement="floating"
                    fill="outline"
                    [autoGrow]="true"
                    [counter]="true"
                    maxlength="200"
                    formControlName="note"
                  ></ion-textarea>
                `,
              },
              {
                label: 'TypeScript',
                lang: 'ts',
                code: code`
                  import { Component, inject } from '@angular/core';
                  import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
                  import { IonInput, IonInputPasswordToggle, IonTextarea } from '@ionic/angular/standalone';

                  @Component({
                    selector: 'app-contact-form',
                    templateUrl: './contact-form.component.html',
                    imports: [ReactiveFormsModule, IonInput, IonInputPasswordToggle, IonTextarea],
                  })
                  export class ContactFormComponent {
                    private readonly fb = inject(FormBuilder);
                    readonly form = this.fb.nonNullable.group({
                      email: ['', [Validators.required, Validators.email]],
                      password: ['', [Validators.required, Validators.minLength(8)]],
                      note: ['', Validators.maxLength(200)],
                    });
                  }
                `,
              },
            ],
          },
          {
            t: 'table',
            title: 'Cheatsheet `ion-input`',
            head: ['Tipo', 'Props / métodos / eventos'],
            rows: [
              ['Label', '`label`, `labelPlacement` (`start`/`end`/`fixed`/`stacked`/`floating`), slot `label` para label con HTML.'],
              ['Estilo', '`fill` (`outline`/`solid`), `shape` (`round`), `color`, `mode`.'],
              ['Ayuda/errores', '`helperText`, `errorText`, `counter`, `counterFormatter`, `maxlength`.'],
              ['Teclado/autofill', '`type`, `inputmode`, `enterkeyhint`, `autocomplete`, `autocapitalize`, `autocorrect`, `spellcheck`.'],
              ['Otros', '`placeholder`, `clearInput`, `clearOnEdit`, `debounce`, `disabled`, `readonly`, `min`/`max`/`step`, `pattern`.'],
              ['Eventos', '`ionInput` (cada tecla), `ionChange` (al confirmar/blur), `ionFocus`, `ionBlur`.'],
              ['Métodos', '`setFocus()`, `getInputElement()`.'],
              ['`ion-textarea`', 'Igual que input + `autoGrow`, `rows`, `cols`, `wrap`.'],
            ],
          },
        ],
        pitfalls: [
          "Usar `ion-label` + `ion-input` dentro de `ion-item` al estilo Ionic 6: genera warnings y problemas de accesibilidad. Usa `label` en el input.",
          "Escuchar `ionChange` para validar mientras se escribe: dispara al perder foco; usa `ionInput`.",
          "`type=\"number\"` para tarjetas/CVV: pierde ceros a la izquierda y muestra spinners. Usa `type=\"text\"` + `inputmode=\"numeric\"`.",
          "`setFocus()` en `ngOnInit`: el elemento aún no está listo; hazlo en `ionViewDidEnter` o con un pequeño delay.",
        ],
        links: [
          ['ion-input', 'https://ionicframework.com/docs/api/input'],
          ['ion-textarea', 'https://ionicframework.com/docs/api/textarea'],
          ['ion-input-password-toggle', 'https://ionicframework.com/docs/api/input-password-toggle'],
        ],
      },
      {
        id: 'selects',
        title: 'Selects (`ion-select`)',
        tags: ['ion-select', 'ion-select-option', 'interface', 'compareWith', 'multiple'],
        summary: "Selector con interfaz configurable: `alert` (por defecto), `action-sheet`, `popover` o `modal` ⚠ verificar disponibilidad de `modal` en tu versión.",
        when: ["Elegir una opción de una lista corta o media (cuotas, país, tipo de documento)."],
        blocks: [
          {
            t: 'code',
            lang: 'html',
            code: code`
              <ion-select
                label="Cuotas"
                labelPlacement="floating"
                fill="outline"
                interface="popover"
                placeholder="Selecciona"
                formControlName="installments"
                [compareWith]="compareById"
                (ionChange)="onInstallments($event.detail.value)"
              >
                @for (opt of installmentOptions; track opt.id) {
                  <ion-select-option [value]="opt">{{ opt.label }}</ion-select-option>
                }
              </ion-select>

              <ion-select label="Tags" [multiple]="true" okText="Aceptar" cancelText="Cancelar" formControlName="tags">
                <ion-select-option value="food">Comida</ion-select-option>
                <ion-select-option value="travel">Viajes</ion-select-option>
              </ion-select>
            `,
          },
          {
            t: 'code',
            lang: 'ts',
            code: code`
              // Needed when values are objects (identity changes after reload)
              compareById = (a: { id: number } | null, b: { id: number } | null): boolean => a?.id === b?.id;
            `,
          },
          {
            t: 'table',
            title: 'Cheatsheet',
            head: ['Tipo', 'Props / eventos'],
            rows: [
              ['Label/estilo', '`label`, `labelPlacement`, `fill`, `shape`, `justify`, `placeholder`, `toggleIcon`, `expandedIcon`.'],
              ['Comportamiento', '`interface`, `interfaceOptions`, `multiple`, `compareWith`, `disabled`, `okText`, `cancelText`, `selectedText`.'],
              ['Ayuda', '`helperText`, `errorText` ⚠ verificar (disponible en Ionic 8 recientes).'],
              ['Eventos', '`ionChange`, `ionCancel`, `ionDismiss`, `ionFocus`, `ionBlur`.'],
              ['Método', '`open(event?)`.'],
            ],
          },
        ],
        pitfalls: [
          "Valores objeto sin `compareWith`: el select aparece vacío al cargar un valor existente.",
          "`interface=\"popover\"` con `multiple`: revisa la UX, muchas opciones caben mejor en `alert` o `modal`.",
          "Listas muy largas (países): considera un modal con `ion-searchbar`.",
        ],
        links: [['ion-select', 'https://ionicframework.com/docs/api/select']],
      },
      {
        id: 'toggles-checkbox-radio',
        title: 'Toggle, checkbox, radio y range',
        tags: ['ion-toggle', 'ion-checkbox', 'ion-radio-group', 'ion-radio', 'ion-range', 'justify', 'labelPlacement'],
        summary: "Controles booleanos y de selección única/múltiple. Como los inputs, el texto va como contenido/label del propio control, con `labelPlacement` y `justify`.",
        when: ["Ajustes on/off (toggle), aceptar términos (checkbox), elegir método de pago (radio), importes/rangos (range)."],
        blocks: [
          {
            t: 'code',
            lang: 'html',
            code: code`
              <ion-list>
                <ion-item>
                  <ion-toggle formControlName="notifications" justify="space-between">Notificaciones</ion-toggle>
                </ion-item>
                <ion-item>
                  <ion-checkbox formControlName="terms" labelPlacement="end" justify="start">
                    Acepto los <a href="/terms" target="_blank">términos</a>
                  </ion-checkbox>
                </ion-item>
              </ion-list>

              <ion-radio-group formControlName="method" [allowEmptySelection]="false">
                <ion-list-header><ion-label>Método de pago</ion-label></ion-list-header>
                <ion-item><ion-radio value="card">Tarjeta</ion-radio></ion-item>
                <ion-item><ion-radio value="transfer">Transferencia</ion-radio></ion-item>
              </ion-radio-group>

              <ion-range label="Monto" [min]="10" [max]="500" [step]="10" [pin]="true" [ticks]="false" formControlName="amount"></ion-range>
            `,
          },
          {
            t: 'table',
            title: 'Cheatsheet',
            head: ['Componente', 'Props / eventos clave'],
            rows: [
              ['`ion-toggle`', '`checked`, `enableOnOffLabels`, `labelPlacement`, `justify`, `alignment`, `color`, `disabled`. Evento `ionChange` (`detail.checked`).'],
              ['`ion-checkbox`', '`checked`, `indeterminate`, `labelPlacement`, `justify`, `alignment`, `disabled`. Evento `ionChange`.'],
              ['`ion-radio-group`', '`value`, `allowEmptySelection`, `compareWith`, `name`. Evento `ionChange` (`detail.value`).'],
              ['`ion-radio`', '`value`, `labelPlacement`, `justify`, `disabled`.'],
              ['`ion-range`', '`min`, `max`, `step`, `snaps`, `ticks`, `pin`, `pinFormatter`, `dualKnobs`, `label`. Eventos `ionInput`, `ionChange`, `ionKnobMoveStart/End`.'],
            ],
          },
        ],
        pitfalls: [
          "Checkbox de términos con `Validators.required`: para booleanos usa `Validators.requiredTrue`.",
          "Links dentro del label de un checkbox: el clic marca el checkbox; detén la propagación si hace falta.",
        ],
        links: [
          ['ion-toggle', 'https://ionicframework.com/docs/api/toggle'],
          ['ion-checkbox', 'https://ionicframework.com/docs/api/checkbox'],
          ['ion-radio-group', 'https://ionicframework.com/docs/api/radio-group'],
          ['ion-range', 'https://ionicframework.com/docs/api/range'],
        ],
      },
      {
        id: 'segment',
        title: 'Segment (`ion-segment`)',
        tags: ['ion-segment', 'ion-segment-button', 'scrollable', 'filtros'],
        summary: "Grupo de botones excluyentes para cambiar de vista o filtro dentro de la misma página.",
        when: ["Filtros (Todos / Ingresos / Gastos), sub-vistas dentro de una página."],
        blocks: [
          {
            t: 'code',
            lang: 'html',
            code: code`
              <ion-toolbar>
                <ion-segment [value]="filter()" (ionChange)="filter.set($any($event.detail.value))">
                  <ion-segment-button value="all"><ion-label>Todos</ion-label></ion-segment-button>
                  <ion-segment-button value="in"><ion-label>Ingresos</ion-label></ion-segment-button>
                  <ion-segment-button value="out"><ion-label>Gastos</ion-label></ion-segment-button>
                </ion-segment>
              </ion-toolbar>

              @switch (filter()) {
                @case ('in') { <app-income-list></app-income-list> }
                @case ('out') { <app-expense-list></app-expense-list> }
                @default { <app-all-list></app-all-list> }
              }
            `,
          },
          {
            t: 'table',
            head: ['Componente', 'Props / eventos'],
            rows: [
              ['`ion-segment`', '`value`, `scrollable`, `swipeGesture`, `selectOnFocus`, `color`, `disabled`. Evento `ionChange`.'],
              ['`ion-segment-button`', '`value`, `layout` (`icon-top`, `icon-start`…), `disabled`.'],
              ['Nuevos', '`ion-segment-view` / `ion-segment-content` para contenido deslizable ⚠ verificar (Ionic 8.x recientes).'],
            ],
          },
        ],
        pitfalls: [
          "Muchos botones sin `scrollable`: el texto se corta en móvil.",
          "Usar segment para navegación principal entre secciones: eso es trabajo de tabs.",
        ],
        links: [['ion-segment', 'https://ionicframework.com/docs/api/segment']],
      },
      {
        id: 'searchbar',
        title: 'Searchbar (`ion-searchbar`)',
        tags: ['ion-searchbar', 'debounce', 'ionInput', 'showCancelButton', 'filtro'],
        summary: "Campo de búsqueda con estilo de plataforma, `debounce` integrado y botón cancelar opcional.",
        when: ["Filtrar listas locales o lanzar búsquedas al servidor."],
        blocks: [
          {
            t: 'tabs',
            tabs: [
              {
                label: 'Template',
                lang: 'html',
                code: code`
                  <ion-toolbar>
                    <ion-searchbar
                      placeholder="Buscar comercio"
                      [debounce]="300"
                      showCancelButton="focus"
                      cancelButtonText="Cancelar"
                      (ionInput)="query.set($any($event.target).value ?? '')"
                    ></ion-searchbar>
                  </ion-toolbar>

                  <ion-list>
                    @for (p of filtered(); track p.id) {
                      <ion-item>{{ p.merchant }}</ion-item>
                    }
                  </ion-list>
                `,
              },
              {
                label: 'TypeScript',
                lang: 'ts',
                code: code`
                  import { computed, signal } from '@angular/core';

                  readonly query = signal('');
                  readonly payments = signal<Payment[]>([]);
                  readonly filtered = computed(() => {
                    const q = this.query().trim().toLowerCase();
                    return q ? this.payments().filter((p) => p.merchant.toLowerCase().includes(q)) : this.payments();
                  });
                `,
              },
            ],
          },
          {
            t: 'table',
            head: ['Tipo', 'Props / eventos'],
            rows: [
              ['Props', '`placeholder`, `debounce`, `showCancelButton` (`never`/`focus`/`always`), `showClearButton`, `cancelButtonText`, `animated`, `searchIcon`, `inputmode`, `enterkeyhint`, `value`.'],
              ['Eventos', '`ionInput`, `ionChange`, `ionClear`, `ionCancel`, `ionFocus`, `ionBlur`.'],
              ['Métodos', '`setFocus()`, `getInputElement()`.'],
            ],
          },
        ],
        pitfalls: [
          "Lanzar una petición HTTP por tecla sin `debounce` ni `switchMap`: respuestas fuera de orden.",
          "Esperar que `ionChange` se dispare al escribir: usa `ionInput`.",
        ],
        links: [['ion-searchbar', 'https://ionicframework.com/docs/api/searchbar']],
      },
      {
        id: 'infinite-scroll',
        title: 'Infinite scroll (`ion-infinite-scroll`)',
        tags: ['ion-infinite-scroll', 'ionInfinite', 'complete', 'paginación', 'InfiniteScrollCustomEvent'],
        summary: "Dispara `ionInfinite` al acercarse al final del scroll para cargar la siguiente página. Debes llamar a `complete()` al terminar.",
        when: ["Listas paginadas del servidor (historial de movimientos, feed)."],
        blocks: [
          {
            t: 'tabs',
            tabs: [
              {
                label: 'Template',
                lang: 'html',
                code: code`
                  <ion-list>
                    @for (m of items(); track m.id) {
                      <ion-item>{{ m.description }}</ion-item>
                    }
                  </ion-list>

                  <ion-infinite-scroll threshold="150px" [disabled]="!hasMore()" (ionInfinite)="loadMore($event)">
                    <ion-infinite-scroll-content loadingSpinner="crescent" loadingText="Cargando…"></ion-infinite-scroll-content>
                  </ion-infinite-scroll>
                `,
              },
              {
                label: 'TypeScript',
                lang: 'ts',
                code: code`
                  import { InfiniteScrollCustomEvent } from '@ionic/angular/standalone';

                  private page = 0;
                  readonly items = signal<Movement[]>([]);
                  readonly hasMore = signal(true);

                  async loadMore(ev?: InfiniteScrollCustomEvent): Promise<void> {
                    const res = await this.api.movementsAsync(++this.page, 20);
                    if (res.ok && res.data) {
                      this.items.update((list) => [...list, ...res.data!.items]);
                      this.hasMore.set(res.data.hasMore);
                    }
                    await ev?.target.complete(); // ALWAYS, also on error
                  }
                `,
              },
            ],
          },
          {
            t: 'table',
            head: ['Tipo', 'Props / eventos'],
            rows: [
              ['`ion-infinite-scroll`', '`threshold` (px o %), `position` (`bottom`/`top`), `disabled`. Evento `ionInfinite`. Método `complete()`.'],
              ['`ion-infinite-scroll-content`', '`loadingSpinner`, `loadingText`.'],
            ],
          },
        ],
        pitfalls: [
          "No llamar `complete()` en errores: el infinite scroll queda bloqueado para siempre.",
          "No desactivarlo cuando no hay más datos: dispara peticiones vacías en bucle.",
          "Colocarlo fuera de `ion-content`.",
        ],
        links: [['ion-infinite-scroll', 'https://ionicframework.com/docs/api/infinite-scroll']],
      },
      {
        id: 'refresher',
        title: 'Pull to refresh (`ion-refresher`)',
        tags: ['ion-refresher', 'ionRefresh', 'RefresherCustomEvent', 'pull to refresh'],
        summary: "Gesto de tirar hacia abajo para recargar. Va como primer hijo de `ion-content` con `slot=\"fixed\"`.",
        when: ["Listas y dashboards con datos que cambian en el servidor."],
        blocks: [
          {
            t: 'tabs',
            tabs: [
              {
                label: 'Template',
                lang: 'html',
                code: code`
                  <ion-content>
                    <ion-refresher slot="fixed" (ionRefresh)="refresh($event)">
                      <ion-refresher-content></ion-refresher-content>
                    </ion-refresher>
                    ...
                  </ion-content>
                `,
              },
              {
                label: 'TypeScript',
                lang: 'ts',
                code: code`
                  import { RefresherCustomEvent } from '@ionic/angular/standalone';

                  async refresh(ev: RefresherCustomEvent): Promise<void> {
                    try {
                      await this.load();
                    } finally {
                      await ev.target.complete();
                    }
                  }
                `,
              },
            ],
          },
          {
            t: 'table',
            head: ['Tipo', 'Props / eventos / métodos'],
            rows: [
              ['Props', '`pullFactor`, `pullMin`, `pullMax`, `closeDuration`, `snapbackDuration`, `disabled`.'],
              ['Eventos', '`ionRefresh`, `ionPull`, `ionStart`.'],
              ['Métodos', '`complete()`, `cancel()`, `getProgress()`.'],
              ['`ion-refresher-content`', '`pullingIcon`, `pullingText`, `refreshingSpinner`, `refreshingText`.'],
            ],
          },
        ],
        pitfalls: [
          "Olvidar `slot=\"fixed\"` o no ponerlo dentro de `ion-content`.",
          "No llamar `complete()` en caso de error: el spinner queda girando.",
        ],
        links: [['ion-refresher', 'https://ionicframework.com/docs/api/refresher']],
      },
      {
        id: 'skeleton',
        title: 'Skeleton, spinner y progress bar',
        tags: ['ion-skeleton-text', 'ion-spinner', 'ion-progress-bar', 'loading state'],
        summary: "Placeholders mientras carga: `ion-skeleton-text` imita el contenido final; `ion-spinner` y `ion-progress-bar` indican progreso.",
        when: ["Primera carga de una lista o card; acciones de duración incierta."],
        blocks: [
          {
            t: 'code',
            lang: 'html',
            code: code`
              @if (loading()) {
                <ion-list>
                  @for (i of [1, 2, 3, 4]; track i) {
                    <ion-item>
                      <ion-thumbnail slot="start"><ion-skeleton-text [animated]="true"></ion-skeleton-text></ion-thumbnail>
                      <ion-label>
                        <h3><ion-skeleton-text [animated]="true" class="w-60"></ion-skeleton-text></h3>
                        <p><ion-skeleton-text [animated]="true" class="w-30"></ion-skeleton-text></p>
                      </ion-label>
                    </ion-item>
                  }
                </ion-list>
              } @else {
                <!-- real content -->
              }

              <ion-progress-bar type="indeterminate"></ion-progress-bar>
              <ion-progress-bar [value]="uploadProgress()" [buffer]="1"></ion-progress-bar>
              <ion-spinner name="crescent"></ion-spinner>
            `,
          },
          {
            t: 'code',
            lang: 'scss',
            code: code`
              .w-60 { width: 60%; }
              .w-30 { width: 30%; }
              ion-skeleton-text { --border-radius: 6px; }
            `,
          },
          {
            t: 'table',
            head: ['Componente', 'Props'],
            rows: [
              ['`ion-skeleton-text`', '`animated`. Tamaño vía CSS (`width`, `height`, `--border-radius`).'],
              ['`ion-spinner`', '`name` (`bubbles`, `circles`, `circular`, `crescent`, `dots`, `lines`, `lines-sharp`…), `duration`, `paused`, `color`.'],
              ['`ion-progress-bar`', '`type` (`determinate`/`indeterminate`), `value` (0–1), `buffer`, `reversed`, `color`.'],
            ],
          },
        ],
        pitfalls: [
          "Skeletons con dimensiones muy distintas al contenido real: saltos de layout al cargar.",
          "Usar `style=\"width:60%\"` inline si tienes CSP estricta sin `unsafe-inline` en `style-src`: usa clases.",
        ],
        links: [
          ['ion-skeleton-text', 'https://ionicframework.com/docs/api/skeleton-text'],
          ['ion-progress-bar', 'https://ionicframework.com/docs/api/progress-bar'],
          ['ion-spinner', 'https://ionicframework.com/docs/api/spinner'],
        ],
      },
      {
        id: 'virtual-scroll',
        title: 'Virtual scroll (Angular CDK)',
        tags: ['virtual scroll', 'cdk-virtual-scroll-viewport', 'ion-content-scroll-host', 'listas grandes'],
        summary: "`ion-virtual-scroll` se eliminó en Ionic 6. La alternativa recomendada en Angular es `cdk-virtual-scroll-viewport` de `@angular/cdk`, renderizando solo los items visibles.",
        when: ["Listas de miles de elementos con altura fija o predecible."],
        blocks: [
          {
            t: 'code',
            lang: 'bash',
            code: code`
              npm install @angular/cdk
            `,
          },
          {
            t: 'tabs',
            tabs: [
              {
                label: 'Template',
                lang: 'html',
                code: code`
                  <ion-content [scrollY]="false">
                    <!-- ion-content-scroll-host: Ionic features (collapsible header, etc.) use this element as scroller -->
                    <cdk-virtual-scroll-viewport itemSize="72" minBufferPx="900" maxBufferPx="1350" class="ion-content-scroll-host">
                      <ion-list>
                        <ion-item *cdkVirtualFor="let m of movements(); trackBy: trackById" class="row">
                          <ion-label>
                            <h3>{{ m.description }}</h3>
                            <p>{{ m.date | date: 'short' }}</p>
                          </ion-label>
                        </ion-item>
                      </ion-list>
                    </cdk-virtual-scroll-viewport>
                  </ion-content>
                `,
              },
              {
                label: 'TypeScript',
                lang: 'ts',
                code: code`
                  import { ScrollingModule } from '@angular/cdk/scrolling';
                  import { IonContent, IonItem, IonLabel, IonList } from '@ionic/angular/standalone';
                  import { DatePipe } from '@angular/common';

                  @Component({
                    selector: 'app-movements',
                    templateUrl: './movements.page.html',
                    styleUrls: ['./movements.page.scss'],
                    imports: [ScrollingModule, IonContent, IonList, IonItem, IonLabel, DatePipe],
                  })
                  export class MovementsPage {
                    readonly movements = signal<Movement[]>([]);
                    trackById = (_: number, m: Movement) => m.id;
                  }
                `,
              },
              {
                label: 'SCSS',
                lang: 'scss',
                code: code`
                  cdk-virtual-scroll-viewport {
                    height: 100%;
                    width: 100%;
                  }
                  .row {
                    height: 72px; // must match itemSize
                  }
                `,
              },
            ],
          },
        ],
        pitfalls: [
          "Items con altura variable y `itemSize` fijo: saltos y huecos. Fija la altura o usa otra estrategia (paginación).",
          "Viewport sin altura: no renderiza nada.",
          "Combinarlo con `ion-infinite-scroll` sin probar: usa `scrolledIndexChange` del CDK para paginar.",
        ],
        links: [
          ['Virtual Scroll (Ionic)', 'https://ionicframework.com/docs/angular/virtual-scroll'],
          ['CDK Scrolling', 'https://material.angular.dev/cdk/scrolling/overview'],
        ],
      },
    ],
  },

  /* ===================================================================
     6. OVERLAYS
     =================================================================== */
  {
    id: 'overlays',
    num: 6,
    title: 'Overlays',
    desc: "`ModalController`, `AlertController`, `ToastController`, `LoadingController`, `ActionSheetController`, popover, modales inline y sheet modals.",
    topics: [
      {
        id: 'modal-controller',
        title: 'Modal con `ModalController`',
        tags: ['ModalController', 'componentProps', 'dismiss', 'onWillDismiss', 'role'],
        summary: "Crea un modal desde código pasando un componente standalone y sus inputs (`componentProps`). El modal se cierra con `dismiss(data, role)` y quien lo abrió recibe `{ data, role }`.",
        when: ["Flujos que devuelven un resultado (seleccionar tarjeta, confirmar pago, editar un registro)."],
        blocks: [
          {
            t: 'tabs',
            tabs: [
              {
                label: 'Abrir',
                lang: 'ts',
                code: code`
                  import { inject } from '@angular/core';
                  import { ModalController } from '@ionic/angular/standalone';
                  import { SelectCardModal, CardResult } from './select-card.modal';

                  private readonly modalCtrl = inject(ModalController);

                  async chooseCard(): Promise<void> {
                    const modal = await this.modalCtrl.create({
                      component: SelectCardModal,
                      componentProps: { preselectedId: this.cardId() }, // mapped to inputs
                      canDismiss: true,
                    });
                    await modal.present();

                    const { data, role } = await modal.onWillDismiss<CardResult>();
                    if (role === 'confirm' && data) this.cardId.set(data.id);
                  }
                `,
              },
              {
                label: 'Componente modal',
                lang: 'ts',
                code: code`
                  import { Component, inject, input } from '@angular/core';
                  import {
                    IonButton, IonButtons, IonContent, IonHeader, IonItem, IonList, IonTitle, IonToolbar, ModalController,
                  } from '@ionic/angular/standalone';

                  export interface CardResult { id: string; }

                  @Component({
                    selector: 'app-select-card',
                    template: \`
                      <ion-header>
                        <ion-toolbar>
                          <ion-buttons slot="start"><ion-button (click)="cancel()">Cancelar</ion-button></ion-buttons>
                          <ion-title>Tarjetas</ion-title>
                        </ion-toolbar>
                      </ion-header>
                      <ion-content>
                        <ion-list>
                          @for (c of cards; track c.id) {
                            <ion-item [button]="true" (click)="select(c.id)">{{ c.label }}</ion-item>
                          }
                        </ion-list>
                      </ion-content>
                    \`,
                    imports: [IonHeader, IonToolbar, IonButtons, IonButton, IonTitle, IonContent, IonList, IonItem],
                  })
                  export class SelectCardModal {
                    private readonly modalCtrl = inject(ModalController);
                    readonly preselectedId = input<string>();
                    readonly cards = [{ id: 'c1', label: 'Visa ···· 4242' }];

                    cancel(): Promise<boolean> {
                      return this.modalCtrl.dismiss(null, 'cancel');
                    }
                    select(id: string): Promise<boolean> {
                      return this.modalCtrl.dismiss({ id } satisfies CardResult, 'confirm');
                    }
                  }
                `,
              },
            ],
          },
          {
            t: 'table',
            title: 'Opciones de `create()` más usadas',
            head: ['Opción', 'Uso'],
            rows: [
              ['`component`, `componentProps`', 'Componente y sus inputs.'],
              ['`breakpoints`, `initialBreakpoint`, `backdropBreakpoint`, `handle`', 'Sheet modal (ver [Sheet modal](#/overlays/sheet-modal)).'],
              ['`presentingElement`', 'Card modal en iOS (la página de detrás se encoge).'],
              ['`canDismiss`', '`boolean` o función async que devuelve `boolean` (confirmar antes de cerrar).'],
              ['`backdropDismiss`, `showBackdrop`', 'Cerrar tocando fuera / mostrar fondo.'],
              ['`cssClass`, `id`, `keyboardClose`, `animated`, `mode`', 'Estilo y comportamiento.'],
            ],
          },
        ],
        pitfalls: [
          "Importar `ModalController` desde `@ionic/angular` en apps standalone.",
          "Cerrar con `this.modalCtrl.dismiss()` cuando hay varios modales abiertos: cierra el de arriba; usa el `id` si necesitas otro.",
          "Pasar datos con un servicio global en vez de `componentProps` + `dismiss`: acoplamiento y estado sucio.",
        ],
        links: [['ion-modal', 'https://ionicframework.com/docs/api/modal']],
      },
      {
        id: 'inline-modal',
        title: 'Modal inline (`<ion-modal>` en el template)',
        tags: ['ion-modal', 'isOpen', 'trigger', 'ng-template', 'didDismiss'],
        summary: "Declaras el modal en el template y lo controlas con `isOpen` o `trigger`. El contenido dentro de `<ng-template>` se crea al abrir y se destruye al cerrar.",
        when: ["Modales sencillos ligados a una página, sin necesidad de reutilizarlos en otras."],
        blocks: [
          {
            t: 'tabs',
            tabs: [
              {
                label: 'Template',
                lang: 'html',
                code: code`
                  <ion-button id="open-help">Ayuda</ion-button>

                  <!-- Opened by trigger id -->
                  <ion-modal trigger="open-help">
                    <ng-template>
                      <ion-header>
                        <ion-toolbar>
                          <ion-title>Ayuda</ion-title>
                          <ion-buttons slot="end"><ion-button (click)="helpModal.dismiss()">Cerrar</ion-button></ion-buttons>
                        </ion-toolbar>
                      </ion-header>
                      <ion-content class="ion-padding">…</ion-content>
                    </ng-template>
                  </ion-modal>

                  <!-- Opened by state -->
                  <ion-modal [isOpen]="showTerms()" (didDismiss)="showTerms.set(false)">
                    <ng-template>
                      <app-terms></app-terms>
                    </ng-template>
                  </ion-modal>
                `,
              },
              {
                label: 'TypeScript',
                lang: 'ts',
                code: code`
                  import { Component, signal, viewChild } from '@angular/core';
                  import { IonModal } from '@ionic/angular/standalone';

                  export class CheckoutPage {
                    readonly showTerms = signal(false);
                    readonly helpModal = viewChild.required(IonModal); // or a template ref (#helpModal)
                  }
                `,
              },
            ],
          },
        ],
        pitfalls: [
          "No sincronizar `isOpen` en `didDismiss`: el modal no vuelve a abrirse (el valor sigue en `true`).",
          "Poner el contenido sin `<ng-template>`: se renderiza siempre, aunque el modal esté cerrado.",
          "Olvidar importar `IonModal` en el standalone.",
        ],
        links: [['ion-modal (inline)', 'https://ionicframework.com/docs/api/modal#inline-modals-recommended']],
      },
      {
        id: 'sheet-modal',
        title: 'Sheet modal y card modal',
        tags: ['breakpoints', 'initialBreakpoint', 'backdropBreakpoint', 'handle', 'presentingElement', 'bottom sheet'],
        summary: "Un sheet modal se ancla abajo y tiene alturas de parada (`breakpoints`). El card modal (iOS) apila el modal sobre la página que se encoge (`presentingElement`).",
        when: ["Acciones contextuales tipo bottom sheet (detalles de un movimiento, filtros, mapa + lista)."],
        blocks: [
          {
            t: 'tabs',
            tabs: [
              {
                label: 'Template',
                lang: 'html',
                code: code`
                  <ion-modal
                    [isOpen]="selected() !== null"
                    [breakpoints]="[0, 0.35, 0.75, 1]"
                    [initialBreakpoint]="0.35"
                    [backdropBreakpoint]="0.5"
                    handleBehavior="cycle"
                    (didDismiss)="selected.set(null)"
                  >
                    <ng-template>
                      <ion-content class="ion-padding">
                        <h2>{{ selected()?.merchant }}</h2>
                      </ion-content>
                    </ng-template>
                  </ion-modal>
                `,
              },
              {
                label: 'TypeScript',
                lang: 'ts',
                code: code`
                  // Card modal (iOS): pass the element behind it
                  const modal = await this.modalCtrl.create({
                    component: EditProfileModal,
                    presentingElement: document.querySelector('ion-router-outlet') ?? undefined,
                  });
                  await modal.present();

                  // Change breakpoint programmatically
                  await modal.setCurrentBreakpoint(0.75);
                `,
              },
            ],
          },
          {
            t: 'table',
            head: ['Prop', 'Uso'],
            rows: [
              ['`breakpoints`', 'Array 0–1 de alturas permitidas. Incluir `0` permite cerrar deslizando.'],
              ['`initialBreakpoint`', 'Altura inicial (debe estar en `breakpoints`).'],
              ['`backdropBreakpoint`', 'Desde qué altura el fondo se oscurece y bloquea la página.'],
              ['`handle`, `handleBehavior`', 'Mostrar el asa; `cycle` alterna breakpoints al tocarla.'],
              ['`expandToScroll`', 'Si el contenido hace scroll antes de expandir ⚠ verificar (Ionic 8 recientes).'],
              ['Evento `ionBreakpointDidChange`', '`detail.breakpoint`.'],
            ],
          },
        ],
        pitfalls: [
          "`initialBreakpoint` que no está en `breakpoints`: error en consola y el modal no se abre.",
          "Usar `backdropBreakpoint` bajo con contenido interactivo detrás que no esperabas bloquear.",
        ],
        links: [['Sheet modal', 'https://ionicframework.com/docs/api/modal#sheet-modal']],
      },
      {
        id: 'alert',
        title: 'Alertas (`AlertController`)',
        tags: ['AlertController', 'alert', 'buttons', 'role', 'inputs', 'confirm'],
        summary: "Diálogos de confirmación o entrada breve. Cada botón tiene `role` y opcionalmente `handler`; `onDidDismiss` devuelve `role` y `data`.",
        when: ["Confirmar acciones destructivas o importantes, pedir un dato corto."],
        blocks: [
          {
            t: 'code',
            lang: 'ts',
            code: code`
              import { AlertController } from '@ionic/angular/standalone';

              private readonly alertCtrl = inject(AlertController);

              async confirmPayment(amount: string): Promise<boolean> {
                const alert = await this.alertCtrl.create({
                  header: 'Confirmar pago',
                  message: 'Vas a pagar ' + amount + '.',
                  buttons: [
                    { text: 'Cancelar', role: 'cancel' },
                    { text: 'Pagar', role: 'confirm' },
                  ],
                });
                await alert.present();
                const { role } = await alert.onDidDismiss();
                return role === 'confirm';
              }

              async askAlias(): Promise<string | null> {
                const alert = await this.alertCtrl.create({
                  header: 'Alias de la tarjeta',
                  inputs: [{ name: 'alias', type: 'text', placeholder: 'Ej. Personal', attributes: { maxlength: 20 } }],
                  buttons: [{ text: 'Cancelar', role: 'cancel' }, { text: 'Guardar', role: 'confirm' }],
                });
                await alert.present();
                const { role, data } = await alert.onDidDismiss<{ values: { alias: string } }>();
                return role === 'confirm' ? data?.values.alias ?? null : null;
              }
            `,
          },
          {
            t: 'table',
            head: ['Opción', 'Uso'],
            rows: [
              ['`header`, `subHeader`, `message`', 'Textos (message admite HTML sanitizado).'],
              ['`buttons`', '`string` o `{ text, role, handler, cssClass }`. `handler` que devuelve `false` evita el cierre.'],
              ['`inputs`', '`{ name, type, placeholder, value, label, checked, attributes }` (text, number, radio, checkbox…).'],
              ['`backdropDismiss`, `cssClass`, `mode`', 'Comportamiento y estilo.'],
              ['Inline', '`<ion-alert [isOpen] [buttons] (didDismiss)>` o `trigger`.'],
            ],
          },
        ],
        pitfalls: [
          "Mezclar `type: 'radio'` con inputs de texto en el mismo alert: no está soportado.",
          "Meter HTML de usuario en `message`: aunque se sanitiza, evita contenido no confiable.",
        ],
        links: [['ion-alert', 'https://ionicframework.com/docs/api/alert']],
      },
      {
        id: 'toast',
        title: 'Toasts (`ToastController`)',
        tags: ['ToastController', 'toast', 'duration', 'position', 'positionAnchor', 'swipeGesture'],
        summary: "Mensajes breves no bloqueantes. Pueden tener icono, botones y anclarse a un elemento (p. ej. sobre la tab bar).",
        when: ["Confirmaciones (\"Pago enviado\"), errores no críticos, \"Sin conexión\"."],
        blocks: [
          {
            t: 'code',
            lang: 'ts',
            code: code`
              import { ToastController } from '@ionic/angular/standalone';

              private readonly toastCtrl = inject(ToastController);

              async notify(message: string, color: 'success' | 'danger' | 'medium' = 'medium'): Promise<void> {
                const toast = await this.toastCtrl.create({
                  message,
                  color,
                  duration: 2500,
                  position: 'bottom',
                  positionAnchor: 'main-tab-bar', // id of an element to sit above
                  swipeGesture: 'vertical',
                  buttons: [{ text: 'OK', role: 'cancel' }],
                });
                await toast.present();
              }
            `,
          },
          {
            t: 'table',
            head: ['Opción', 'Uso'],
            rows: [
              ['`message`, `header`, `icon`, `color`', 'Contenido.'],
              ['`duration`', 'ms; `0` = no se cierra solo.'],
              ['`position`, `positionAnchor`', '`top`/`middle`/`bottom` y elemento de anclaje.'],
              ['`buttons`, `swipeGesture`, `layout`', 'Acciones, cerrar deslizando, `baseline`/`stacked`.'],
            ],
          },
        ],
        pitfalls: [
          "Toast tapando la tab bar o el botón principal: usa `positionAnchor`.",
          "Encadenar muchos toasts seguidos: se apilan; cierra el anterior o agrupa mensajes.",
        ],
        links: [['ion-toast', 'https://ionicframework.com/docs/api/toast']],
      },
      {
        id: 'loading',
        title: 'Loading (`LoadingController`)',
        tags: ['LoadingController', 'loading', 'spinner', 'try/finally'],
        summary: "Overlay bloqueante con spinner mientras se ejecuta una operación. Ciérralo siempre en `finally`.",
        when: ["Operaciones que el usuario no debe interrumpir (procesar pago, login)."],
        blocks: [
          {
            t: 'code',
            lang: 'ts',
            code: code`
              import { LoadingController } from '@ionic/angular/standalone';

              private readonly loadingCtrl = inject(LoadingController);

              async withLoading<T>(message: string, work: () => Promise<T>): Promise<T> {
                const loading = await this.loadingCtrl.create({ message, spinner: 'crescent', backdropDismiss: false });
                await loading.present();
                try {
                  return await work();
                } finally {
                  await loading.dismiss();
                }
              }

              // usage
              const result = await this.withLoading('Procesando pago…', () => this.payments.payAsync(request));
            `,
          },
          {
            t: 'table',
            head: ['Opción', 'Uso'],
            rows: [
              ['`message`, `spinner`', 'Texto y tipo de spinner (`null` para ocultarlo).'],
              ['`duration`', 'Cierre automático (ms).'],
              ['`backdropDismiss`, `showBackdrop`, `translucent`, `cssClass`', 'Comportamiento y estilo.'],
            ],
          },
        ],
        pitfalls: [
          "No cerrar el loading en errores: la app queda bloqueada.",
          "Usar loading bloqueante para cargas de lista: mejor skeleton o refresher.",
          "Llamar `dismiss()` antes de que `present()` termine: el loading puede quedar abierto. Espera `present()`.",
        ],
        links: [['ion-loading', 'https://ionicframework.com/docs/api/loading']],
      },
      {
        id: 'action-sheet',
        title: 'Action sheet (`ActionSheetController`)',
        tags: ['ActionSheetController', 'action sheet', 'destructive', 'role', 'data'],
        summary: "Lista de acciones desde abajo. Los botones pueden tener `role` (`destructive`, `cancel`) y `data`.",
        when: ["Elegir una acción sobre un elemento (compartir, editar, eliminar) o la fuente de una foto."],
        blocks: [
          {
            t: 'code',
            lang: 'ts',
            code: code`
              import { ActionSheetController } from '@ionic/angular/standalone';

              private readonly sheetCtrl = inject(ActionSheetController);

              async cardActions(cardId: string): Promise<void> {
                const sheet = await this.sheetCtrl.create({
                  header: 'Tarjeta',
                  buttons: [
                    { text: 'Ver movimientos', data: { action: 'movements' } },
                    { text: 'Bloquear', role: 'destructive', data: { action: 'freeze' } },
                    { text: 'Cancelar', role: 'cancel' },
                  ],
                });
                await sheet.present();
                const { data } = await sheet.onDidDismiss<{ action: string }>();
                if (data?.action === 'freeze') await this.freeze(cardId);
              }
            `,
          },
        ],
        pitfalls: [
          "No incluir botón `cancel`: en Android/desktop el usuario no ve cómo salir (aunque pueda tocar fuera).",
          "Demasiadas opciones (>6): considera un modal o popover.",
        ],
        links: [['ion-action-sheet', 'https://ionicframework.com/docs/api/action-sheet']],
      },
      {
        id: 'popover',
        title: 'Popover (inline y `PopoverController`)',
        tags: ['ion-popover', 'PopoverController', 'trigger', 'triggerAction', 'event'],
        summary: "Contenido flotante anclado a un elemento: menús contextuales, tooltips enriquecidos, selectores pequeños.",
        when: ["Menú \"más opciones\" (⋮) en toolbars, especialmente en desktop."],
        blocks: [
          {
            t: 'tabs',
            tabs: [
              {
                label: 'Template',
                lang: 'html',
                code: code`
                  <ion-button id="more-btn" fill="clear" aria-label="Más opciones">
                    <ion-icon slot="icon-only" name="ellipsis-vertical"></ion-icon>
                  </ion-button>

                  <ion-popover trigger="more-btn" triggerAction="click" [dismissOnSelect]="true" side="bottom" alignment="end">
                    <ng-template>
                      <ion-list lines="none">
                        <ion-item [button]="true" (click)="export()">Exportar</ion-item>
                        <ion-item [button]="true" (click)="settings()">Ajustes</ion-item>
                      </ion-list>
                    </ng-template>
                  </ion-popover>
                `,
              },
              {
                label: 'TypeScript',
                lang: 'ts',
                code: code`
                  import { PopoverController } from '@ionic/angular/standalone';

                  private readonly popoverCtrl = inject(PopoverController);

                  async openMenu(ev: Event): Promise<void> {
                    const popover = await this.popoverCtrl.create({
                      component: MoreMenuComponent,
                      event: ev,                 // anchors to the clicked element
                      dismissOnSelect: true,
                    });
                    await popover.present();
                    const { data } = await popover.onDidDismiss<string>();
                  }
                `,
              },
            ],
          },
          {
            t: 'table',
            head: ['Prop', 'Uso'],
            rows: [
              ['`trigger`, `triggerAction`', 'Id del elemento y `click` / `hover` / `context-menu`.'],
              ['`side`, `alignment`, `reference`', 'Posicionamiento (`top`/`bottom`/`start`/`end`; `start`/`center`/`end`; `trigger`/`event`).'],
              ['`size`', '`auto` o `cover` (ancho del trigger).'],
              ['`dismissOnSelect`, `showBackdrop`, `arrow`', 'Comportamiento.'],
            ],
          },
        ],
        pitfalls: [
          "Popover con `trigger` cuyo id no existe al renderizar: no abre (y avisa en consola).",
          "`triggerAction=\"hover\"` en móvil: no hay hover; usa click.",
        ],
        links: [['ion-popover', 'https://ionicframework.com/docs/api/popover']],
      },
      {
        id: 'ui-service',
        title: 'Patrón: servicio `UiService` para overlays',
        tags: ['UiService', 'toast', 'confirm', 'loading', 'patrón'],
        summary: "Centraliza toasts, confirmaciones y loading en un servicio para mantener estilo consistente y simplificar las páginas.",
        when: ["En cualquier app mediana: evita repetir la misma configuración de overlays en cada página."],
        blocks: [
          {
            t: 'code',
            lang: 'ts',
            file: 'core/services/ui.service.ts',
            code: code`
              import { Injectable, inject } from '@angular/core';
              import { AlertController, LoadingController, ToastController } from '@ionic/angular/standalone';

              @Injectable({ providedIn: 'root' })
              export class UiService {
                private readonly toastCtrl = inject(ToastController);
                private readonly alertCtrl = inject(AlertController);
                private readonly loadingCtrl = inject(LoadingController);

                async toast(message: string, color: 'success' | 'danger' | 'warning' | 'medium' = 'medium'): Promise<void> {
                  const t = await this.toastCtrl.create({ message, color, duration: 2500, position: 'bottom' });
                  await t.present();
                }

                async confirm(header: string, message: string, okText = 'Aceptar'): Promise<boolean> {
                  const a = await this.alertCtrl.create({
                    header,
                    message,
                    buttons: [{ text: 'Cancelar', role: 'cancel' }, { text: okText, role: 'confirm' }],
                  });
                  await a.present();
                  return (await a.onDidDismiss()).role === 'confirm';
                }

                async busy<T>(message: string, work: () => Promise<T>): Promise<T> {
                  const l = await this.loadingCtrl.create({ message });
                  await l.present();
                  try {
                    return await work();
                  } finally {
                    await l.dismiss();
                  }
                }
              }
            `,
          },
        ],
        pitfalls: [
          "Inyectar controllers en servicios con `providedIn: 'root'` antes de `provideIonicAngular()`: asegúrate de que el bootstrap lo incluye.",
          "Mostrar errores técnicos crudos (`HttpErrorResponse.message`) en el toast: traduce a mensajes de usuario.",
        ],
        links: [['Overlays (Ionic)', 'https://ionicframework.com/docs/api/modal']],
      },
    ],
  },

  /* ===================================================================
     7. FORMULARIOS
     =================================================================== */
  {
    id: 'formularios',
    num: 7,
    title: 'Formularios',
    desc: "Reactive forms con componentes Ionic, validación con `errorText`/`helperText`, máscaras con Maskito y un formulario de pago completo, consistente en móvil y desktop.",
    topics: [
      {
        id: 'reactive-forms',
        title: 'Reactive forms con componentes Ionic',
        tags: ['ReactiveFormsModule', 'formControlName', 'FormBuilder', 'nonNullable', 'ion-input'],
        summary: "Los componentes de formulario de Ionic implementan `ControlValueAccessor`: funcionan con `formControlName`/`[formControl]` igual que un `<input>` nativo. Importa `ReactiveFormsModule` y cada componente Ionic que uses.",
        when: ["Cualquier formulario con validación (login, registro, pagos, perfil)."],
        blocks: [
          {
            t: 'tabs',
            tabs: [
              {
                label: 'TypeScript',
                lang: 'ts',
                code: code`
                  import { Component, inject } from '@angular/core';
                  import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
                  import { IonButton, IonInput, IonItem, IonList, IonSelect, IonSelectOption, IonToggle } from '@ionic/angular/standalone';

                  @Component({
                    selector: 'app-profile-form',
                    templateUrl: './profile-form.component.html',
                    imports: [ReactiveFormsModule, IonList, IonItem, IonInput, IonSelect, IonSelectOption, IonToggle, IonButton],
                  })
                  export class ProfileFormComponent {
                    private readonly fb = inject(FormBuilder);

                    readonly form = this.fb.nonNullable.group({
                      fullName: ['', [Validators.required, Validators.maxLength(80)]],
                      email: ['', [Validators.required, Validators.email]],
                      docType: ['CC', Validators.required],
                      newsletter: [false],
                    });

                    save(): void {
                      if (this.form.invalid) {
                        this.form.markAllAsTouched(); // shows errorText on every invalid field
                        return;
                      }
                      const value = this.form.getRawValue(); // fully typed
                    }
                  }
                `,
              },
              {
                label: 'Template',
                lang: 'html',
                code: code`
                  <form [formGroup]="form" (ngSubmit)="save()">
                    <ion-list>
                      <ion-item>
                        <ion-input label="Nombre completo" labelPlacement="stacked" formControlName="fullName"
                                   autocomplete="name" errorText="Obligatorio (máx. 80)"></ion-input>
                      </ion-item>
                      <ion-item>
                        <ion-input label="Correo" labelPlacement="stacked" type="email" inputmode="email"
                                   formControlName="email" autocomplete="email" errorText="Correo no válido"></ion-input>
                      </ion-item>
                      <ion-item>
                        <ion-select label="Tipo de documento" labelPlacement="stacked" interface="popover" formControlName="docType">
                          <ion-select-option value="CC">Cédula</ion-select-option>
                          <ion-select-option value="PA">Pasaporte</ion-select-option>
                        </ion-select>
                      </ion-item>
                      <ion-item>
                        <ion-toggle formControlName="newsletter">Recibir novedades</ion-toggle>
                      </ion-item>
                    </ion-list>
                    <ion-button expand="block" type="submit" class="ion-margin">Guardar</ion-button>
                  </form>
                `,
              },
            ],
          },
          {
            t: 'note',
            kind: 'info',
            text: "`ion-button type=\"submit\"` dentro de un `<form>` dispara `ngSubmit`. Para que Enter en el teclado envíe el formulario, usa `enterkeyhint=\"send\"` o `go` y asegúrate de que el form tiene un botón submit.",
          },
        ],
        pitfalls: [
          "Olvidar importar `ReactiveFormsModule` o el componente Ionic: `No value accessor for form control`.",
          "Usar `[(ngModel)]` y `formControlName` a la vez en el mismo control.",
          "Leer `form.value` (excluye controles deshabilitados) cuando necesitas todo: usa `getRawValue()`.",
        ],
        links: [
          ['Input + forms', 'https://ionicframework.com/docs/api/input'],
          ['Angular Reactive Forms', 'https://angular.dev/guide/forms/reactive-forms'],
        ],
      },
      {
        id: 'validacion',
        title: 'Validación y mensajes con `errorText` / `helperText`',
        tags: ['errorText', 'helperText', 'ion-invalid', 'ion-touched', 'markAllAsTouched', 'validators'],
        summary: "`errorText` se muestra cuando el control tiene las clases `ion-invalid` e `ion-touched`. En Angular, Ionic las sincroniza automáticamente con el estado del control (`ng-invalid`/`ng-touched`). `helperText` se muestra mientras no hay error.",
        when: ["Mostrar errores por campo solo después de que el usuario interactúe o intente enviar."],
        blocks: [
          {
            t: 'tabs',
            tabs: [
              {
                label: 'TypeScript',
                lang: 'ts',
                file: 'shared/forms/form-errors.ts',
                code: code`
                  import { AbstractControl } from '@angular/forms';

                  const MESSAGES: Record<string, (e: any) => string> = {
                    required: () => 'Este campo es obligatorio',
                    requiredTrue: () => 'Debes aceptar para continuar',
                    email: () => 'Correo no válido',
                    minlength: (e) => 'Mínimo ' + e.requiredLength + ' caracteres',
                    maxlength: (e) => 'Máximo ' + e.requiredLength + ' caracteres',
                    min: (e) => 'El valor mínimo es ' + e.min,
                    max: (e) => 'El valor máximo es ' + e.max,
                    pattern: () => 'Formato no válido',
                    luhn: () => 'Número de tarjeta no válido',
                    cardLength: () => 'Longitud de tarjeta no válida',
                    expiryFormat: () => 'Usa el formato MM/AA',
                    expired: () => 'La tarjeta está vencida',
                  };

                  /** First error message of a control, or '' when valid. */
                  export function errorMessage(control: AbstractControl | null): string {
                    if (!control?.errors) return '';
                    const [key, value] = Object.entries(control.errors)[0];
                    return MESSAGES[key]?.(value) ?? 'Valor no válido';
                  }
                `,
              },
              {
                label: 'Template',
                lang: 'html',
                code: code`
                  <ion-input
                    label="Monto"
                    labelPlacement="stacked"
                    inputmode="decimal"
                    formControlName="amount"
                    helperText="Entre 1 y 5.000"
                    [errorText]="err('amount')"
                  ></ion-input>
                `,
              },
              {
                label: 'Página',
                lang: 'ts',
                code: code`
                  import { errorMessage } from '../../shared/forms/form-errors';

                  err(name: string): string {
                    return errorMessage(this.form.get(name));
                  }
                `,
              },
            ],
          },
          {
            t: 'note',
            kind: 'warn',
            text: "Si en algún componente custom no se aplican las clases, puedes forzarlas: `[class.ion-invalid]=\"ctrl.invalid\"` y `[class.ion-touched]=\"ctrl.touched\"`.",
          },
        ],
        pitfalls: [
          "Errores visibles al abrir el formulario: no marques como touched al iniciar; hazlo en submit con `markAllAsTouched()`.",
          "`errorText` vacío pero control inválido: se pinta en rojo sin mensaje. Usa siempre un helper de mensajes.",
          "Validar importes con `Validators.pattern` sobre strings con coma/punto según locale: normaliza antes.",
        ],
        links: [['Helper & Error Text', 'https://ionicframework.com/docs/api/input#helper--error-text']],
      },
      {
        id: 'mascaras',
        title: 'Máscaras de entrada con Maskito',
        tags: ['Maskito', '@maskito/angular', 'mask', 'maskitoElement', 'getInputElement', 'tarjeta', 'fecha'],
        summary: "Ionic recomienda **Maskito** para máscaras en `ion-input`. Como el `<input>` real está dentro del componente, hay que indicar a Maskito cómo obtenerlo con `maskitoElement`.",
        when: ["Número de tarjeta, fecha de expiración, teléfonos, documentos, importes."],
        blocks: [
          {
            t: 'code',
            lang: 'bash',
            code: code`
              npm install @maskito/core @maskito/angular @maskito/kit
            `,
          },
          {
            t: 'tabs',
            tabs: [
              {
                label: 'TypeScript',
                lang: 'ts',
                code: code`
                  import { MaskitoDirective } from '@maskito/angular';
                  import { MaskitoElementPredicate, MaskitoOptions } from '@maskito/core';
                  import { maskitoDateOptionsGenerator, maskitoNumberOptionsGenerator } from '@maskito/kit';

                  const D = /\d/;

                  export const CARD_MASK: MaskitoOptions = {
                    mask: [D, D, D, D, ' ', D, D, D, D, ' ', D, D, D, D, ' ', D, D, D, D],
                  };
                  export const EXPIRY_MASK: MaskitoOptions = maskitoDateOptionsGenerator({ mode: 'mm/yy', separator: '/' });
                  export const CVV_MASK: MaskitoOptions = { mask: /^\d{0,4}$/ };
                  export const AMOUNT_MASK: MaskitoOptions = maskitoNumberOptionsGenerator({
                    maximumFractionDigits: 2,
                    thousandSeparator: '.',
                    decimalSeparator: ',',
                    min: 0,
                  }); // ⚠ verify option names for your @maskito/kit version

                  // ion-input renders the real <input> inside: tell Maskito where it is
                  export const ionInputPredicate: MaskitoElementPredicate = async (el) =>
                    (el as HTMLIonInputElement).getInputElement();

                  // In the component: imports: [MaskitoDirective, ...]
                `,
              },
              {
                label: 'Template',
                lang: 'html',
                code: code`
                  <ion-input
                    label="Número de tarjeta"
                    labelPlacement="stacked"
                    inputmode="numeric"
                    autocomplete="cc-number"
                    formControlName="cardNumber"
                    [maskito]="cardMask"
                    [maskitoElement]="maskPredicate"
                  ></ion-input>
                `,
              },
            ],
          },
        ],
        pitfalls: [
          "Aplicar `[maskito]` sin `[maskitoElement]`: la máscara no hace nada porque apunta al host `ion-input`.",
          "Validar el valor con espacios de la máscara: limpia con `value.replace(/\\D/g, '')` antes de validar o enviar.",
          "Usar `type=\"number\"` con máscara: incompatible; usa `type=\"text\"` + `inputmode`.",
        ],
        links: [
          ['Ionic Input Masking', 'https://ionicframework.com/docs/api/input#input-masking'],
          ['Maskito', 'https://maskito.dev'],
        ],
      },
      {
        id: 'formulario-pago',
        title: 'Formulario de pago completo (tarjeta, expiración, CVV)',
        tags: ['pago', 'tarjeta', 'Luhn', 'CVV', 'expiración', 'autocomplete cc-number', 'ServiceResult', 'responsive'],
        summary: "Formulario de pago con componentes nativos de Ionic (`ion-list`, `ion-item`, `ion-input`, `ion-select`, `ion-checkbox`), máscaras, validación Luhn, expiración y CVV según marca, envío con `ServiceResult<T>` y layout consistente en móvil y desktop.",
        when: [
          "Checkout dentro de la app cuando tu proveedor de pagos lo permite (tokenización en servidor o SDK).",
          "Como plantilla de cualquier formulario sensible: misma semántica y estilos en todas las plataformas.",
        ],
        blocks: [
          {
            t: 'note',
            kind: 'danger',
            text: "**PCI DSS:** no guardes el número de tarjeta ni el CVV en el dispositivo ni en tus logs. Lo ideal es tokenizar con el SDK/endpoint del proveedor de pagos y enviar a tu backend solo el token. Este ejemplo envía los datos a un endpoint propio solo para ilustrar el patrón.",
          },
          {
            t: 'tabs',
            tabs: [
              {
                label: 'Template',
                lang: 'html',
                file: 'checkout.page.html',
                code: code`
                  <ion-header>
                    <ion-toolbar>
                      <ion-buttons slot="start"><ion-back-button defaultHref="/tabs/home"></ion-back-button></ion-buttons>
                      <ion-title>Pagar</ion-title>
                    </ion-toolbar>
                  </ion-header>

                  <ion-content class="ion-padding">
                    <div class="checkout">
                      <form [formGroup]="form" (ngSubmit)="pay()" novalidate>
                        <ion-list lines="full" class="pay-list">
                          <ion-item>
                            <ion-input label="Titular de la tarjeta" labelPlacement="stacked" formControlName="holder"
                                       autocomplete="cc-name" autocapitalize="characters" [errorText]="err('holder')"></ion-input>
                          </ion-item>

                          <ion-item>
                            <ion-input label="Número de tarjeta" labelPlacement="stacked" formControlName="cardNumber"
                                       inputmode="numeric" autocomplete="cc-number" placeholder="0000 0000 0000 0000"
                                       [maskito]="cardMask" [maskitoElement]="maskPredicate" [errorText]="err('cardNumber')">
                              <ion-note slot="end" class="brand">{{ brand() }}</ion-note>
                            </ion-input>
                          </ion-item>

                          <div class="pay-row">
                            <ion-item>
                              <ion-input label="Vencimiento" labelPlacement="stacked" formControlName="expiry"
                                         inputmode="numeric" autocomplete="cc-exp" placeholder="MM/AA"
                                         [maskito]="expiryMask" [maskitoElement]="maskPredicate" [errorText]="err('expiry')"></ion-input>
                            </ion-item>
                            <ion-item>
                              <ion-input label="CVV" labelPlacement="stacked" formControlName="cvv" type="password"
                                         inputmode="numeric" autocomplete="cc-csc" [placeholder]="brand() === 'amex' ? '0000' : '000'"
                                         [maskito]="cvvMask" [maskitoElement]="maskPredicate" [errorText]="err('cvv')"></ion-input>
                            </ion-item>
                          </div>

                          <ion-item>
                            <ion-select label="Cuotas" labelPlacement="stacked" interface="popover" formControlName="installments">
                              @for (n of installmentOptions; track n) {
                                <ion-select-option [value]="n">{{ n }} {{ n === 1 ? 'cuota' : 'cuotas' }}</ion-select-option>
                              }
                            </ion-select>
                          </ion-item>

                          <ion-item lines="none">
                            <ion-checkbox formControlName="acceptTerms" labelPlacement="end" justify="start">
                              Acepto las condiciones del pago
                            </ion-checkbox>
                          </ion-item>
                        </ion-list>

                        <div class="pay-summary">
                          <span>Total</span>
                          <strong>{{ amount() | currency: 'USD' }}</strong>
                        </div>

                        <ion-button expand="block" type="submit" [disabled]="submitting()">
                          @if (submitting()) { <ion-spinner name="crescent"></ion-spinner> } @else { Pagar {{ amount() | currency: 'USD' }} }
                        </ion-button>
                      </form>
                    </div>
                  </ion-content>
                `,
              },
              {
                label: 'TypeScript',
                lang: 'ts',
                file: 'checkout.page.ts',
                code: code`
                  import { Component, computed, inject, input, signal } from '@angular/core';
                  import { CurrencyPipe } from '@angular/common';
                  import { toSignal } from '@angular/core/rxjs-interop';
                  import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
                  import { firstValueFrom } from 'rxjs';
                  import { MaskitoDirective } from '@maskito/angular';
                  import {
                    IonBackButton, IonButton, IonButtons, IonCheckbox, IonContent, IonHeader, IonInput, IonItem, IonList,
                    IonNote, IonSelect, IonSelectOption, IonSpinner, IonTitle, IonToolbar, NavController,
                  } from '@ionic/angular/standalone';

                  import { CARD_MASK, CVV_MASK, EXPIRY_MASK, ionInputPredicate } from '../../shared/forms/masks';
                  import { cardBrand, cvvValidator, expiryValidator, luhnValidator } from '../../shared/forms/card-validators';
                  import { errorMessage } from '../../shared/forms/form-errors';
                  import { PaymentService } from '../../core/services/payment.service';
                  import { UiService } from '../../core/services/ui.service';

                  @Component({
                    selector: 'app-checkout',
                    templateUrl: './checkout.page.html',
                    styleUrls: ['./checkout.page.scss'],
                    imports: [
                      ReactiveFormsModule, MaskitoDirective, CurrencyPipe,
                      IonHeader, IonToolbar, IonButtons, IonBackButton, IonTitle, IonContent, IonList, IonItem,
                      IonInput, IonNote, IonSelect, IonSelectOption, IonCheckbox, IonButton, IonSpinner,
                    ],
                  })
                  export class CheckoutPage {
                    private readonly fb = inject(FormBuilder);
                    private readonly payments = inject(PaymentService);
                    private readonly ui = inject(UiService);
                    private readonly nav = inject(NavController);

                    readonly amount = input(0);             // from route data / query (withComponentInputBinding)
                    readonly submitting = signal(false);
                    readonly installmentOptions = [1, 3, 6, 12];

                    readonly cardMask = CARD_MASK;
                    readonly expiryMask = EXPIRY_MASK;
                    readonly cvvMask = CVV_MASK;
                    readonly maskPredicate = ionInputPredicate;

                    readonly form = this.fb.nonNullable.group({
                      holder: ['', [Validators.required, Validators.maxLength(26)]],
                      cardNumber: ['', [Validators.required, luhnValidator]],
                      expiry: ['', [Validators.required, expiryValidator]],
                      cvv: ['', [Validators.required]],
                      installments: [1, Validators.required],
                      acceptTerms: [false, Validators.requiredTrue],
                    });

                    private readonly cardValue = toSignal(this.form.controls.cardNumber.valueChanges, { initialValue: '' });
                    readonly brand = computed(() => cardBrand(this.cardValue()));

                    constructor() {
                      // CVV length depends on the card brand (Amex = 4)
                      this.form.controls.cvv.addValidators(cvvValidator(() => this.brand()));
                    }

                    err(name: keyof typeof this.form.controls): string {
                      return errorMessage(this.form.controls[name]);
                    }

                    async pay(): Promise<void> {
                      this.form.controls.cvv.updateValueAndValidity();
                      if (this.form.invalid) {
                        this.form.markAllAsTouched();
                        return;
                      }
                      const v = this.form.getRawValue();
                      this.submitting.set(true);
                      try {
                        const res = await firstValueFrom(
                          this.payments.pay({
                            amount: this.amount(),
                            installments: v.installments,
                            holder: v.holder.trim(),
                            cardNumber: v.cardNumber.replace(/\D/g, ''),
                            expiry: v.expiry,
                            cvv: v.cvv,
                          }),
                        );
                        if (res.ok && res.data) {
                          this.form.reset();
                          await this.nav.navigateRoot(['/receipt', res.data.receiptId]);
                        } else if (res.status === 402) {
                          await this.ui.toast('Pago rechazado por el emisor', 'danger');
                        } else if (res.status === 0) {
                          await this.ui.toast('Sin conexión. Inténtalo de nuevo.', 'warning');
                        } else {
                          await this.ui.toast(res.error?.message ?? 'No se pudo procesar el pago', 'danger');
                        }
                      } finally {
                        this.form.controls.cvv.reset(''); // never keep the CVV around
                        this.submitting.set(false);
                      }
                    }
                  }
                `,
              },
              {
                label: 'Validators',
                lang: 'ts',
                file: 'shared/forms/card-validators.ts',
                code: code`
                  import { AbstractControl, ValidationErrors, ValidatorFn } from '@angular/forms';

                  export type CardBrand = 'visa' | 'mastercard' | 'amex' | 'unknown';

                  export function cardBrand(value: string): CardBrand {
                    const n = (value ?? '').replace(/\D/g, '');
                    if (/^4/.test(n)) return 'visa';
                    if (/^(5[1-5]|2[2-7])/.test(n)) return 'mastercard';
                    if (/^3[47]/.test(n)) return 'amex';
                    return 'unknown';
                  }

                  /** Luhn checksum + length 13..19. Empty values are left to Validators.required. */
                  export const luhnValidator: ValidatorFn = (c: AbstractControl): ValidationErrors | null => {
                    const digits = String(c.value ?? '').replace(/\D/g, '');
                    if (!digits) return null;
                    if (digits.length < 13 || digits.length > 19) return { cardLength: true };
                    let sum = 0;
                    for (let i = 0; i < digits.length; i++) {
                      let d = Number(digits[digits.length - 1 - i]);
                      if (i % 2 === 1) {
                        d *= 2;
                        if (d > 9) d -= 9;
                      }
                      sum += d;
                    }
                    return sum % 10 === 0 ? null : { luhn: true };
                  };

                  /** MM/YY, valid until the last day of that month. */
                  export const expiryValidator: ValidatorFn = (c: AbstractControl): ValidationErrors | null => {
                    if (!c.value) return null;
                    const m = /^(\d{2})\/(\d{2})$/.exec(String(c.value));
                    if (!m) return { expiryFormat: true };
                    const month = Number(m[1]);
                    const year = 2000 + Number(m[2]);
                    if (month < 1 || month > 12) return { expiryFormat: true };
                    const endOfMonth = new Date(year, month, 0, 23, 59, 59);
                    return endOfMonth < new Date() ? { expired: true } : null;
                  };

                  /** 3 digits, or 4 for Amex. */
                  export function cvvValidator(brand: () => CardBrand): ValidatorFn {
                    return (c: AbstractControl): ValidationErrors | null => {
                      if (!c.value) return null;
                      const len = brand() === 'amex' ? 4 : 3;
                      return new RegExp('^\\d{' + len + '}$').test(String(c.value)) ? null : { pattern: true };
                    };
                  }
                `,
              },
              {
                label: 'SCSS',
                lang: 'scss',
                file: 'checkout.page.scss',
                code: code`
                  // Same semantics on mobile and desktop: a single centered column that grows a bit on wide screens
                  .checkout {
                    max-width: 560px;
                    margin: 0 auto;
                  }

                  .pay-list {
                    border-radius: 12px;
                    overflow: hidden;
                    margin-bottom: 16px;
                  }

                  // Expiry + CVV side by side on every screen size (short fields)
                  .pay-row {
                    display: grid;
                    grid-template-columns: 1fr 1fr;
                  }

                  .brand {
                    text-transform: uppercase;
                    font-size: 12px;
                  }

                  .pay-summary {
                    display: flex;
                    justify-content: space-between;
                    align-items: baseline;
                    padding: 8px 4px 16px;
                    font-size: 18px;
                  }

                  @media (min-width: 768px) {
                    .checkout {
                      padding-top: 24px;
                    }
                    .pay-list {
                      box-shadow: 0 1px 3px rgba(0, 0, 0, 0.08);
                    }
                  }
                `,
              },
              {
                label: 'Servicio',
                lang: 'ts',
                file: 'core/services/payment.service.ts',
                code: code`
                  import { Injectable, inject } from '@angular/core';
                  import { HttpClient } from '@angular/common/http';
                  import { Observable } from 'rxjs';
                  import { environment } from '../../../environments/environment';
                  import { ServiceResult, toServiceResult } from '../http/service-result';

                  export interface PayRequest {
                    amount: number;
                    installments: number;
                    holder: string;
                    cardNumber: string;
                    expiry: string;
                    cvv: string;
                  }
                  export interface PayResponse {
                    receiptId: string;
                    authorizationCode: string;
                  }

                  @Injectable({ providedIn: 'root' })
                  export class PaymentService {
                    private readonly http = inject(HttpClient);
                    private readonly baseUrl = environment.apiUrl + '/payments';

                    pay(req: PayRequest): Observable<ServiceResult<PayResponse>> {
                      return toServiceResult(this.http.post<PayResponse>(this.baseUrl, req, { observe: 'response' }));
                    }
                  }
                `,
              },
            ],
          },
          {
            t: 'list',
            title: 'Decisiones de diseño',
            items: [
              "`ion-list` + `ion-item` + `labelPlacement=\"stacked\"`: misma semántica y aspecto en `ios`/`md`, móvil y desktop; nada de Angular Material.",
              "`inputmode=\"numeric\"` + `type=\"text\"` para tarjeta y fecha: teclado numérico sin perder ceros iniciales. CVV con `type=\"password\"`.",
              "`autocomplete=\"cc-*\"`: permite autocompletar desde el gestor de tarjetas del sistema.",
              "Errores visibles solo tras tocar el campo o intentar pagar (`markAllAsTouched`).",
              "Respuesta con `ServiceResult<T>`: la página decide según `status` (402 rechazo, 0 sin red) sin `try/catch` de `HttpErrorResponse`. Ver [Patrón ServiceResult](#/datos-http/service-result).",
            ],
          },
        ],
        pitfalls: [
          "Guardar número de tarjeta o CVV en `Preferences`, `localStorage` o logs.",
          "Validar la tarjeta con la máscara aplicada (espacios incluidos).",
          "Mostrar el botón habilitado mientras se envía: doble cobro. Deshabilítalo y usa idempotency key en backend.",
          "Mensajes genéricos ante un 402/422: el usuario necesita saber si debe cambiar de tarjeta o reintentar.",
        ],
        links: [
          ['ion-input', 'https://ionicframework.com/docs/api/input'],
          ['Input masking', 'https://ionicframework.com/docs/api/input#input-masking'],
          ['Autocomplete (cc-*) en MDN', 'https://developer.mozilla.org/docs/Web/HTML/Attributes/autocomplete'],
        ],
      },
    ],
  },

  /* ===================================================================
     8. THEMING
     =================================================================== */
  {
    id: 'theming',
    num: 8,
    title: 'Theming',
    desc: "Variables CSS de Ionic, paleta propia, dark mode, modos `ios`/`md`, `Platform`, shadow parts, safe areas y responsive con breakpoints.",
    topics: [
      {
        id: 'variables-css',
        title: 'Variables CSS globales y de componente',
        tags: ['--ion-color-primary', '--ion-background-color', '--ion-text-color', '--ion-font-family', 'variables.scss'],
        summary: "Ionic se personaliza con variables CSS: globales (`--ion-*` en `:root`) y por componente (`--background`, `--color`, `--padding-start`…). Se definen en `src/theme/variables.scss` y `global.scss`.",
        when: ["Aplicar la marca de la empresa a toda la app sin pelear con selectores."],
        blocks: [
          {
            t: 'code',
            lang: 'scss',
            file: 'src/theme/variables.scss',
            code: code`
              :root {
                // Brand primary (each color needs the 6 variables)
                --ion-color-primary: #6a3cf0;
                --ion-color-primary-rgb: 106, 60, 240;
                --ion-color-primary-contrast: #ffffff;
                --ion-color-primary-contrast-rgb: 255, 255, 255;
                --ion-color-primary-shade: #5d35d3;   // ~12% darker
                --ion-color-primary-tint: #7950f2;    // ~10% lighter

                // Global app variables
                --ion-font-family: 'Inter', system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif;
                --ion-background-color: #f6f7fb;
                --ion-text-color: #1c2330;
              }
            `,
          },
          {
            t: 'code',
            lang: 'scss',
            title: 'Variables de componente',
            code: code`
              ion-toolbar {
                --background: var(--ion-color-primary);
                --color: var(--ion-color-primary-contrast);
              }

              ion-content.checkout-bg {
                --background: linear-gradient(180deg, #f6f7fb 0%, #ffffff 100%);
              }

              ion-item.compact {
                --padding-start: 12px;
                --inner-padding-end: 12px;
                --min-height: 44px;
              }

              ion-input.custom {
                --highlight-color-focused: var(--ion-color-primary);
                --placeholder-color: #8a93a3;
                --border-radius: 10px; // with fill="outline"
              }
            `,
          },
          {
            t: 'table',
            title: 'Variables globales útiles',
            head: ['Variable', 'Afecta'],
            rows: [
              ['`--ion-color-{name}` (+ `-rgb`, `-contrast`, `-contrast-rgb`, `-shade`, `-tint`)', 'Colores de la paleta: primary, secondary, tertiary, success, warning, danger, light, medium, dark.'],
              ['`--ion-background-color` / `-rgb`', 'Fondo de la app.'],
              ['`--ion-text-color` / `-rgb`', 'Color de texto por defecto.'],
              ['`--ion-font-family`', 'Tipografía.'],
              ['`--ion-safe-area-top/right/bottom/left`', 'Márgenes seguros (notch, barra de gestos).'],
              ['`--ion-toolbar-background`, `--ion-item-background`, `--ion-tab-bar-background`', 'Fondos de componentes globales.'],
              ['`--ion-color-step-*` / `--ion-background-color-step-*`', 'Escala de grises derivada (cambió de nombre en Ionic 8) ⚠ verificar.'],
            ],
          },
        ],
        pitfalls: [
          "Definir solo `--ion-color-primary` sin `-rgb`, `-shade`, `-tint`, `-contrast`: estados activos/hover y transparencias salen mal.",
          "Intentar `ion-button { background: red }`: no aplica; el estilo está en el Shadow DOM. Usa `--background`.",
          "Poner variables de componente en el SCSS de una página y esperar que afecten a overlays: los overlays se montan fuera de la página; usa `global.scss` o `cssClass`.",
        ],
        links: [
          ['CSS Variables', 'https://ionicframework.com/docs/theming/css-variables'],
          ['Colores', 'https://ionicframework.com/docs/theming/colors'],
          ['Color Generator', 'https://ionicframework.com/docs/theming/color-generator'],
        ],
      },
      {
        id: 'paleta',
        title: 'Añadir un color propio a la paleta',
        tags: ['color', 'ion-color-brand', 'custom color', 'color="brand"'],
        summary: "Para usar `color=\"brand\"` en cualquier componente, define las 6 variables y la clase `.ion-color-brand` que las mapea a `--ion-color-base`.",
        when: ["Colores corporativos adicionales (p. ej. color de una marca de tarjeta o un estado propio)."],
        blocks: [
          {
            t: 'code',
            lang: 'scss',
            file: 'src/theme/variables.scss',
            code: code`
              :root {
                --ion-color-brand: #00a39b;
                --ion-color-brand-rgb: 0, 163, 155;
                --ion-color-brand-contrast: #ffffff;
                --ion-color-brand-contrast-rgb: 255, 255, 255;
                --ion-color-brand-shade: #008f88;
                --ion-color-brand-tint: #1aaca5;
              }

              .ion-color-brand {
                --ion-color-base: var(--ion-color-brand);
                --ion-color-base-rgb: var(--ion-color-brand-rgb);
                --ion-color-contrast: var(--ion-color-brand-contrast);
                --ion-color-contrast-rgb: var(--ion-color-brand-contrast-rgb);
                --ion-color-shade: var(--ion-color-brand-shade);
                --ion-color-tint: var(--ion-color-brand-tint);
              }
            `,
          },
          {
            t: 'code',
            lang: 'html',
            code: code`
              <ion-button color="brand">Continuar</ion-button>
              <ion-badge color="brand">Nuevo</ion-badge>
            `,
          },
        ],
        pitfalls: [
          "Olvidar la clase `.ion-color-brand`: el atributo `color=\"brand\"` no hace nada.",
          "Elegir `contrast` sin comprobar accesibilidad (ratio ≥ 4.5:1 para texto).",
        ],
        links: [['Nuevos colores', 'https://ionicframework.com/docs/theming/colors#adding-colors']],
      },
      {
        id: 'dark-mode',
        title: 'Dark mode (paletas de Ionic 8)',
        tags: ['dark mode', 'ion-palette-dark', 'dark.system.css', 'dark.class.css', 'prefers-color-scheme'],
        summary: "Ionic 8 trae paletas oscuras listas para importar: según el sistema (`dark.system.css`), siempre (`dark.always.css`) o por clase (`dark.class.css`, activada con `.ion-palette-dark` en `<html>`).",
        when: [
          "`dark.system.css`: seguir la preferencia del sistema operativo (lo más simple).",
          "`dark.class.css`: permitir que el usuario elija claro/oscuro/sistema dentro de la app.",
        ],
        blocks: [
          {
            t: 'tabs',
            tabs: [
              {
                label: 'SCSS',
                lang: 'scss',
                file: 'src/global.scss',
                code: code`
                  /* Pick ONE palette strategy */
                  /* @import '@ionic/angular/css/palettes/dark.always.css'; */
                  /* @import '@ionic/angular/css/palettes/dark.system.css'; */
                  @import '@ionic/angular/css/palettes/dark.class.css';

                  // Optional: brand tweaks only for dark
                  .ion-palette-dark {
                    --ion-color-primary: #8f6cff;
                    --ion-color-primary-rgb: 143, 108, 255;
                    --ion-color-primary-shade: #7e5fe0;
                    --ion-color-primary-tint: #9a7bff;
                  }
                `,
              },
              {
                label: 'TypeScript',
                lang: 'ts',
                file: 'core/services/theme.service.ts',
                code: code`
                  import { Injectable, signal } from '@angular/core';
                  import { Preferences } from '@capacitor/preferences';

                  export type ThemePref = 'light' | 'dark' | 'system';

                  @Injectable({ providedIn: 'root' })
                  export class ThemeService {
                    private readonly media = window.matchMedia('(prefers-color-scheme: dark)');
                    readonly pref = signal<ThemePref>('system');

                    async init(): Promise<void> {
                      const { value } = await Preferences.get({ key: 'theme' });
                      this.pref.set((value as ThemePref) ?? 'system');
                      this.apply();
                      this.media.addEventListener('change', () => this.apply());
                    }

                    async set(pref: ThemePref): Promise<void> {
                      this.pref.set(pref);
                      await Preferences.set({ key: 'theme', value: pref });
                      this.apply();
                    }

                    private apply(): void {
                      const dark = this.pref() === 'dark' || (this.pref() === 'system' && this.media.matches);
                      document.documentElement.classList.toggle('ion-palette-dark', dark);
                    }
                  }
                `,
              },
            ],
          },
          {
            t: 'note',
            kind: 'info',
            text: "Combínalo con el plugin [StatusBar](#/plugins/status-bar) para que los iconos de la barra de estado contrasten con el tema activo.",
          },
        ],
        pitfalls: [
          "Importar varias paletas a la vez: comportamiento impredecible.",
          "Usar la clase antigua `body.dark` de Ionic 6/7: en Ionic 8 la clase es `.ion-palette-dark` en `html`.",
          "Colores hardcodeados en SCSS de páginas (`#fff`): no cambian con el tema. Usa variables.",
        ],
        links: [['Dark Mode', 'https://ionicframework.com/docs/theming/dark-mode']],
      },
      {
        id: 'modos-plataforma',
        title: 'Modos `ios` / `md` y clases de plataforma',
        tags: ['mode', 'ios', 'md', 'provideIonicAngular', 'plt-android', 'plt-ios', 'Platform'],
        summary: "El **modo** define el estilo visual (`ios` o `md`) y por defecto depende de la plataforma. Puede forzarse globalmente o por componente. Ionic añade al `<html>` el atributo `mode` y clases `plt-*` para estilos por plataforma.",
        when: [
          "Unificar el aspecto en ambas plataformas (p. ej. todo en `md` o todo en `ios`).",
          "Ajustes puntuales de estilo para Android o iOS.",
        ],
        blocks: [
          {
            t: 'code',
            lang: 'ts',
            code: code`
              // main.ts — force one look everywhere and other global config
              provideIonicAngular({
                mode: 'md',
                animated: true,
                rippleEffect: true,
                backButtonText: '',
              });
            `,
          },
          {
            t: 'code',
            lang: 'html',
            code: code`
              <!-- Per component -->
              <ion-segment mode="ios">…</ion-segment>
            `,
          },
          {
            t: 'code',
            lang: 'scss',
            code: code`
              // Style by mode (attribute set by Ionic on <html>)
              html[mode='ios'] ion-toolbar {
                --border-width: 0;
              }

              // Style by platform (classes on <html>: plt-android, plt-ios, plt-capacitor, plt-desktop, plt-mobile…)
              .plt-android ion-title {
                font-weight: 600;
              }
            `,
          },
          {
            t: 'note',
            kind: 'info',
            text: "Para probar el otro modo en el navegador añade `?ionic:mode=ios` o `?ionic:mode=md` a la URL de `ionic serve`. Detección de plataforma en TS: ver [Qué corre dónde](#/arquitectura/que-corre-donde).",
          },
        ],
        pitfalls: [
          "Confundir modo con plataforma: un `mode=\"ios\"` en Android sigue siendo Android para los plugins.",
          "Forzar `ios` en Android y olvidar el back button hardware y las expectativas de Material del usuario.",
        ],
        links: [
          ['Platform styles', 'https://ionicframework.com/docs/theming/platform-styles'],
          ['Config global', 'https://ionicframework.com/docs/developing/config'],
        ],
      },
      {
        id: 'shadow-parts',
        title: 'Shadow DOM: `::part()` y variables',
        tags: ['::part', 'shadow DOM', 'native', '::ng-deep', 'cssClass'],
        summary: "Muchos componentes Ionic encapsulan su HTML en Shadow DOM. Para estilizar su interior usa sus **variables CSS** documentadas o las **shadow parts** expuestas con `::part(nombre)`.",
        when: ["Cuando una variable no basta (p. ej. transformar texto del botón, sombras, bordes concretos)."],
        blocks: [
          {
            t: 'code',
            lang: 'scss',
            code: code`
              // Button inner element
              ion-button.pill::part(native) {
                border-radius: 999px;
                text-transform: none;
                letter-spacing: 0;
              }

              // Select pieces
              ion-select::part(placeholder) { color: #8a93a3; }
              ion-select::part(icon) { color: var(--ion-color-primary); }

              // Segment indicator
              ion-segment-button::part(indicator-background) { background: var(--ion-color-primary); }

              // Modal (overlays live outside the page → put this in global.scss)
              ion-modal.rounded::part(content) { border-radius: 16px; }
              ion-modal.rounded {
                --width: min(560px, 100%);
                --height: auto;
              }
            `,
          },
          {
            t: 'table',
            title: 'Parts más usadas (ver cada página de la API)',
            head: ['Componente', 'Parts'],
            rows: [
              ['`ion-button`', '`native`'],
              ['`ion-item`', '`native`, `detail-icon`'],
              ['`ion-select`', '`placeholder`, `text`, `icon`, `label`, `container`'],
              ['`ion-segment-button`', '`native`, `indicator`, `indicator-background`'],
              ['`ion-tab-button`', '`native`'],
              ['`ion-modal`', '`backdrop`, `content`, `handle`'],
              ['`ion-toast`', '`container`, `header`, `message`, `button`, `icon`'],
              ['`ion-searchbar`', '— (solo variables CSS) ⚠ verificar'],
            ],
          },
        ],
        pitfalls: [
          "`::ng-deep` no atraviesa Shadow DOM: solo rompe la encapsulación de Angular.",
          "Estilos de overlays en el SCSS de la página: no aplican porque el overlay se monta en `ion-app`. Usa `global.scss` + `cssClass`.",
          "Encadenar selectores dentro de `::part()` (`::part(native) span`): no está permitido por el estándar.",
        ],
        links: [
          ['CSS Shadow Parts', 'https://ionicframework.com/docs/theming/css-shadow-parts'],
          ['CSS Variables', 'https://ionicframework.com/docs/theming/css-variables'],
        ],
      },
      {
        id: 'responsive',
        title: 'Responsive: breakpoints, utilidades CSS y safe areas',
        tags: ['responsive', 'breakpoints', 'ion-hide-md-down', 'ion-padding', 'safe area', 'edge-to-edge', 'Platform.width'],
        summary: "Ionic ofrece clases utilitarias por breakpoint (padding, texto, flex, display), `ion-split-pane` y `ion-grid`. Las safe areas se exponen como `--ion-safe-area-*`.",
        when: ["Apps que también se usan en tablet/desktop; pantallas con notch o barra de gestos."],
        blocks: [
          {
            t: 'code',
            lang: 'html',
            code: code`
              <!-- Show only on md and up / hide on small -->
              <ion-button class="ion-hide-md-down">Exportar CSV</ion-button>
              <ion-fab class="ion-hide-md-up" slot="fixed" vertical="bottom" horizontal="end">…</ion-fab>

              <div class="ion-padding ion-text-center ion-text-md-start">…</div>
              <ion-row class="ion-justify-content-between ion-align-items-center">…</ion-row>
            `,
          },
          {
            t: 'code',
            lang: 'scss',
            code: code`
              // Same breakpoints as Ionic
              $md: 768px;
              $lg: 992px;

              .dashboard {
                display: grid;
                gap: 12px;
                grid-template-columns: 1fr;

                @media (min-width: $md) { grid-template-columns: repeat(2, 1fr); }
                @media (min-width: $lg) { grid-template-columns: repeat(3, 1fr); }
              }

              // Custom fixed element that must avoid the home indicator / notch
              .bottom-bar {
                padding-bottom: calc(12px + var(--ion-safe-area-bottom, 0px));
              }
            `,
          },
          {
            t: 'table',
            title: 'Clases utilitarias',
            head: ['Grupo', 'Ejemplos'],
            rows: [
              ['Display', '`ion-hide`, `ion-hide-{bp}-up`, `ion-hide-{bp}-down` (bp: sm, md, lg, xl)'],
              ['Padding / margin', '`ion-padding`, `ion-padding-top`, `ion-padding-horizontal`, `ion-no-padding`, `ion-margin`…'],
              ['Texto', '`ion-text-center`, `ion-text-{bp}-start`, `ion-text-wrap`, `ion-text-nowrap`, `ion-text-uppercase`'],
              ['Flex', '`ion-justify-content-*`, `ion-align-items-*`, `ion-align-self-*`, `ion-flex-wrap` ⚠ verificar nombres en Ionic 8'],
              ['Float', '`ion-float-left`, `ion-float-{bp}-right`'],
            ],
          },
          {
            t: 'note',
            kind: 'warn',
            text: "Android 15+ (targetSdk 35+) fuerza el modo **edge-to-edge**: el WebView se dibuja bajo las barras del sistema. Revisa cómo gestiona Capacitor 8 los insets (safe areas, `StatusBar`/`SystemBars`) en la guía de Android ⚠ verificar.",
          },
        ],
        pitfalls: [
          "Elementos `position: fixed` propios sin safe area: quedan bajo el notch o la barra de gestos.",
          "Usar `platform.is('tablet')` para el layout: decide por ancho (CSS) y no por tipo de dispositivo.",
          "Clases utilitarias de Ionic sin importar `display.css`, `padding.css`, etc. en `global.scss`.",
        ],
        links: [
          ['CSS Utilities', 'https://ionicframework.com/docs/layout/css-utilities'],
          ['Responsive Grid', 'https://ionicframework.com/docs/layout/grid'],
          ['Global Stylesheets', 'https://ionicframework.com/docs/layout/global-stylesheets'],
        ],
      },
    ],
  },

  /* ===================================================================
     9. CAPACITOR PLUGINS
     =================================================================== */
  {
    id: 'plugins',
    num: 9,
    title: 'Capacitor plugins',
    desc: "Preferences, Camera, Filesystem, Geolocation, Network, App (deep links, back button), Keyboard, StatusBar, SplashScreen, Push, Local Notifications, Share, Haptics y Browser.",
    topics: [
      {
        id: 'plugins-resumen',
        title: 'Instalación, permisos y patrón general',
        tags: ['npm install', 'npx cap sync', 'checkPermissions', 'requestPermissions', 'PermissionState', 'adaptador'],
        summary: "Todos los plugins oficiales siguen el mismo flujo: `npm install`, `npx cap sync`, añadir permisos nativos si los requiere, y llamar a su API async. Los que acceden a datos sensibles exponen `checkPermissions()` / `requestPermissions()`.",
        when: ["Cada vez que añades un plugin. Úsalo como checklist."],
        blocks: [
          {
            t: 'code',
            lang: 'bash',
            code: code`
              npm install @capacitor/camera @capacitor/preferences @capacitor/filesystem @capacitor/geolocation \
                @capacitor/network @capacitor/app @capacitor/keyboard @capacitor/status-bar @capacitor/splash-screen \
                @capacitor/push-notifications @capacitor/local-notifications @capacitor/share @capacitor/haptics @capacitor/browser
              npx cap sync
            `,
          },
          {
            t: 'code',
            lang: 'ts',
            title: 'Patrón de permisos',
            code: code`
              import { Camera } from '@capacitor/camera';
              import type { PermissionState } from '@capacitor/core';

              // PermissionState: 'prompt' | 'prompt-with-rationale' | 'granted' | 'denied'
              export async function ensureCameraPermission(): Promise<boolean> {
                let state: PermissionState = (await Camera.checkPermissions()).camera;
                if (state === 'prompt' || state === 'prompt-with-rationale') {
                  // Explain WHY before the OS dialog (better acceptance rate)
                  state = (await Camera.requestPermissions({ permissions: ['camera'] })).camera;
                }
                // 'denied': the OS won't prompt again → guide the user to the app settings
                return state === 'granted';
              }
            `,
          },
          {
            t: 'table',
            title: 'Resumen de plugins oficiales',
            head: ['Plugin', 'Paquete', 'Permisos nativos'],
            rows: [
              ['[Preferences](#/plugins/preferences)', '`@capacitor/preferences`', '—'],
              ['[Camera](#/plugins/camera)', '`@capacitor/camera`', 'iOS: `NSCameraUsageDescription`, `NSPhotoLibrary*`. Android: según versión ⚠ verificar'],
              ['[Filesystem](#/plugins/filesystem)', '`@capacitor/filesystem`', 'Solo para almacenamiento público.'],
              ['[Geolocation](#/plugins/geolocation)', '`@capacitor/geolocation`', 'Android: `ACCESS_*_LOCATION`. iOS: `NSLocation*UsageDescription`'],
              ['[Network](#/plugins/network)', '`@capacitor/network`', '—'],
              ['[App](#/plugins/app)', '`@capacitor/app`', 'Deep links: intent-filter / Associated Domains'],
              ['[Keyboard](#/plugins/keyboard)', '`@capacitor/keyboard`', '—'],
              ['[StatusBar](#/plugins/status-bar)', '`@capacitor/status-bar`', '—'],
              ['[SplashScreen](#/plugins/splash-screen)', '`@capacitor/splash-screen`', '—'],
              ['[Push](#/plugins/push-notifications)', '`@capacitor/push-notifications`', 'Firebase (Android), capability Push + APNs (iOS)'],
              ['[Local Notifications](#/plugins/local-notifications)', '`@capacitor/local-notifications`', 'Android 13+: notificaciones; alarmas exactas'],
              ['[Share](#/plugins/share)', '`@capacitor/share`', '—'],
              ['[Haptics](#/plugins/haptics)', '`@capacitor/haptics`', '—'],
              ['[Browser](#/plugins/browser)', '`@capacitor/browser`', '—'],
            ],
          },
          {
            t: 'note',
            kind: 'ok',
            text: "Buena práctica: envuelve cada plugin en un **servicio Angular** (adaptador). Centralizas permisos y errores, y en tests mockeas tu servicio en lugar del plugin. Ver [Mocks de Capacitor](#/testing/mocks-capacitor).",
          },
        ],
        pitfalls: [
          "Instalar un plugin con un major distinto al de `@capacitor/core`.",
          "Pedir permisos al arrancar la app sin contexto: más rechazos. Pídelos justo antes de usar la función.",
          "Tratar `denied` como `prompt`: el sistema ya no muestra el diálogo; debes llevar al usuario a Ajustes.",
        ],
        links: [
          ['APIs oficiales', 'https://capacitorjs.com/docs/apis'],
          ['Permisos en plugins', 'https://capacitorjs.com/docs/plugins/web#permissions'],
        ],
      },
      {
        id: 'preferences',
        title: 'Preferences (clave/valor)',
        tags: ['@capacitor/preferences', 'set', 'get', 'remove', 'keys', 'clear', 'SharedPreferences', 'UserDefaults'],
        summary: "Almacenamiento clave/valor **no cifrado** y persistente: SharedPreferences (Android), UserDefaults (iOS), `localStorage` (web). Solo strings; serializa JSON.",
        when: ["Ajustes de usuario, flags (onboarding visto), idioma, último filtro. Nunca tokens ni datos sensibles."],
        blocks: [
          {
            t: 'code',
            lang: 'ts',
            file: 'core/services/settings.store.ts',
            code: code`
              import { Injectable } from '@angular/core';
              import { Preferences } from '@capacitor/preferences';

              @Injectable({ providedIn: 'root' })
              export class SettingsStore {
                async get<T>(key: string, fallback: T): Promise<T> {
                  const { value } = await Preferences.get({ key });
                  if (value === null) return fallback;
                  try {
                    return JSON.parse(value) as T;
                  } catch {
                    return fallback;
                  }
                }

                set<T>(key: string, value: T): Promise<void> {
                  return Preferences.set({ key, value: JSON.stringify(value) });
                }

                remove(key: string): Promise<void> {
                  return Preferences.remove({ key });
                }

                async keys(): Promise<string[]> {
                  return (await Preferences.keys()).keys;
                }

                clear(): Promise<void> {
                  return Preferences.clear();
                }
              }
            `,
          },
          {
            t: 'note',
            kind: 'info',
            text: "Migrando desde `cordova-plugin-nativestorage`: `Preferences.configure({ group: 'NativeStorage' })` permite leer los datos guardados por ese plugin.",
          },
        ],
        pitfalls: [
          "Guardar tokens, PINs o datos personales: no está cifrado. Usa [almacenamiento seguro](#/seguridad/secure-storage).",
          "Guardar grandes volúmenes (listas de miles de items): usa SQLite o Filesystem.",
          "Asumir que `get` devuelve `undefined`: devuelve `null` si no existe.",
        ],
        links: [['Preferences', 'https://capacitorjs.com/docs/apis/preferences']],
      },
      {
        id: 'camera',
        title: 'Camera',
        tags: ['@capacitor/camera', 'getPhoto', 'pickImages', 'CameraResultType', 'CameraSource', 'pwa-elements'],
        summary: "Captura una foto o elige de la galería. Con `resultType: Uri` obtienes `webPath` (para mostrar) y `path` (ruta nativa) sin pasar base64 por el bridge.",
        when: ["Foto de perfil, escaneo de documentos/tarjetas, adjuntar comprobantes."],
        blocks: [
          {
            t: 'code',
            lang: 'ts',
            code: code`
              import { Camera, CameraResultType, CameraSource, Photo } from '@capacitor/camera';

              export async function takeReceiptPhoto(): Promise<Photo | null> {
                try {
                  return await Camera.getPhoto({
                    quality: 80,
                    width: 1600,                     // downscale: smaller files, faster upload
                    correctOrientation: true,
                    allowEditing: false,
                    resultType: CameraResultType.Uri,
                    source: CameraSource.Prompt,     // Camera | Photos | Prompt
                    promptLabelHeader: 'Comprobante',
                    promptLabelPhoto: 'Elegir de la galería',
                    promptLabelPicture: 'Tomar foto',
                  });
                } catch {
                  return null; // user cancelled
                }
              }

              // photo.webPath → <img [src]="photo.webPath">
              // Upload: const blob = await (await fetch(photo.webPath!)).blob();

              export async function pickMany() {
                const { photos } = await Camera.pickImages({ quality: 80, limit: 5 });
                return photos.map((p) => p.webPath);
              }
            `,
          },
          {
            t: 'tabs',
            title: 'Configuración por plataforma',
            tabs: [
              {
                label: 'iOS',
                lang: 'plist',
                file: 'Info.plist',
                code: code`
                  <key>NSCameraUsageDescription</key>
                  <string>Usamos la cámara para fotografiar tus comprobantes.</string>
                  <key>NSPhotoLibraryUsageDescription</key>
                  <string>Necesitamos acceso a tus fotos para adjuntar comprobantes.</string>
                  <key>NSPhotoLibraryAddUsageDescription</key>
                  <string>Guardamos las fotos que tomes en tu galería.</string>
                `,
              },
              {
                label: 'Android',
                lang: 'xml',
                file: 'AndroidManifest.xml',
                code: code`
                  <!-- Check the plugin README for the exact permissions of your version ⚠ verify -->
                  <uses-permission android:name="android.permission.CAMERA" />
                `,
              },
              {
                label: 'Web',
                lang: 'ts',
                file: 'main.ts',
                code: code`
                  // npm install @ionic/pwa-elements — camera UI for the web implementation
                  import { defineCustomElements } from '@ionic/pwa-elements/loader';

                  defineCustomElements(window);
                `,
              },
            ],
          },
          {
            t: 'note',
            kind: 'warn',
            text: "Revisa en la documentación de `@capacitor/camera` para Capacitor 8 si la API sigue siendo `getPhoto`/`pickImages` o si hay métodos nuevos ⚠ verificar.",
          },
        ],
        pitfalls: [
          "Usar `CameraResultType.Base64` con fotos grandes: lento y con riesgo de quedarse sin memoria. Usa `Uri`.",
          "Falta `NSCameraUsageDescription` en iOS: la app se cierra al abrir la cámara.",
          "No capturar la excepción al cancelar: aparece como error no controlado.",
          "En web sin `@ionic/pwa-elements`: la cámara no muestra interfaz.",
        ],
        links: [['Camera', 'https://capacitorjs.com/docs/apis/camera']],
      },
      {
        id: 'filesystem',
        title: 'Filesystem',
        tags: ['@capacitor/filesystem', 'writeFile', 'readFile', 'Directory.Data', 'Encoding', 'getUri', 'file-transfer'],
        summary: "Leer y escribir archivos en directorios de la app. Texto con `encoding: UTF8`; binarios como base64 (sin `encoding`).",
        when: ["Guardar comprobantes PDF, cache de imágenes, exportar CSV, archivos para compartir."],
        blocks: [
          {
            t: 'code',
            lang: 'ts',
            code: code`
              import { Directory, Encoding, Filesystem } from '@capacitor/filesystem';
              import { Capacitor } from '@capacitor/core';

              // Text / JSON
              await Filesystem.writeFile({
                path: 'receipts/r-123.json',
                data: JSON.stringify(receipt),
                directory: Directory.Data,
                encoding: Encoding.UTF8,
                recursive: true, // create intermediate folders
              });

              const file = await Filesystem.readFile({
                path: 'receipts/r-123.json',
                directory: Directory.Data,
                encoding: Encoding.UTF8,
              });
              const parsed = JSON.parse(file.data as string); // data: string | Blob (Blob on web)

              // Binary: base64 without "encoding"
              await Filesystem.writeFile({ path: 'receipts/r-123.pdf', data: pdfBase64, directory: Directory.Data });

              // List, URI, delete
              const { files } = await Filesystem.readdir({ path: 'receipts', directory: Directory.Data });
              const { uri } = await Filesystem.getUri({ path: 'receipts/r-123.pdf', directory: Directory.Data });
              const imgSrc = Capacitor.convertFileSrc(uri); // usable in <img>/<iframe>
              await Filesystem.deleteFile({ path: 'receipts/r-123.json', directory: Directory.Data });
            `,
          },
          {
            t: 'table',
            title: 'Directorios',
            head: ['Directory', 'Uso'],
            rows: [
              ['`Data`', 'Datos privados persistentes de la app.'],
              ['`Cache`', 'Temporales; el SO puede borrarlos.'],
              ['`Documents`', 'iOS: visible en la app Archivos si se configura. Android: almacenamiento público (requiere permisos según versión).'],
              ['`Library`', 'iOS: datos de soporte no visibles al usuario.'],
              ['`External`, `ExternalStorage`', 'Android: almacenamiento externo (restringido en Android 10+).'],
            ],
          },
          {
            t: 'note',
            kind: 'info',
            text: "`Filesystem.downloadFile` quedó deprecado: para descargas/subidas grandes usa `@capacitor/file-transfer` ⚠ verificar API en tu versión. Para abrir un PDF con otra app, un plugin comunitario como `@capacitor-community/file-opener` ⚠ verificar.",
          },
        ],
        pitfalls: [
          "Leer un binario con `encoding: UTF8`: datos corruptos.",
          "Escribir en `Documents`/`External` en Android moderno sin entender scoped storage: errores de permisos.",
          "Guardar documentos sensibles en `Cache`: pueden desaparecer, y no están cifrados.",
        ],
        links: [['Filesystem', 'https://capacitorjs.com/docs/apis/filesystem']],
      },
      {
        id: 'geolocation',
        title: 'Geolocation',
        tags: ['@capacitor/geolocation', 'getCurrentPosition', 'watchPosition', 'clearWatch', 'ACCESS_FINE_LOCATION'],
        summary: "Posición actual o seguimiento continuo con GPS/red. Requiere permisos de ubicación en ambas plataformas.",
        when: ["Sucursales/cajeros cercanos, validar ubicación en transacciones, tracking."],
        blocks: [
          {
            t: 'code',
            lang: 'ts',
            code: code`
              import { Geolocation, Position } from '@capacitor/geolocation';
              import { Capacitor } from '@capacitor/core';

              export async function currentPosition(): Promise<Position | null> {
                if (Capacitor.isNativePlatform()) {
                  const perm = await Geolocation.requestPermissions(); // not implemented on web
                  if (perm.location !== 'granted' && perm.coarseLocation !== 'granted') return null;
                }
                return Geolocation.getCurrentPosition({ enableHighAccuracy: true, timeout: 10_000, maximumAge: 30_000 });
              }

              // Continuous tracking
              const watchId = await Geolocation.watchPosition({ enableHighAccuracy: true }, (pos, err) => {
                if (err || !pos) return;
                console.log(pos.coords.latitude, pos.coords.longitude, pos.coords.accuracy);
              });
              // later
              await Geolocation.clearWatch({ id: watchId });
            `,
          },
          {
            t: 'tabs',
            tabs: [
              {
                label: 'Android',
                lang: 'xml',
                file: 'AndroidManifest.xml',
                code: code`
                  <uses-permission android:name="android.permission.ACCESS_COARSE_LOCATION" />
                  <uses-permission android:name="android.permission.ACCESS_FINE_LOCATION" />
                  <uses-feature android:name="android.hardware.location.gps" />
                `,
              },
              {
                label: 'iOS',
                lang: 'plist',
                file: 'Info.plist',
                code: code`
                  <key>NSLocationWhenInUseUsageDescription</key>
                  <string>Usamos tu ubicación para mostrarte cajeros cercanos.</string>
                  <key>NSLocationAlwaysAndWhenInUseUsageDescription</key>
                  <string>Usamos tu ubicación para mostrarte cajeros cercanos.</string>
                `,
              },
            ],
          },
        ],
        pitfalls: [
          "No limpiar `watchPosition` al salir de la página: batería y listeners duplicados.",
          "`timeout` corto en interiores: falla aunque el usuario dio permiso.",
          "Esperar seguimiento en background: el JS se pausa; requiere soluciones nativas específicas.",
        ],
        links: [['Geolocation', 'https://capacitorjs.com/docs/apis/geolocation']],
      },
      {
        id: 'network',
        title: 'Network (estado de conexión)',
        tags: ['@capacitor/network', 'getStatus', 'networkStatusChange', 'offline', 'connectionType'],
        summary: "Consulta si hay conexión y de qué tipo (`wifi`, `cellular`, `none`, `unknown`) y escucha cambios.",
        when: ["Banner \"sin conexión\", pausar sincronización, cola offline (ver [Offline-first](#/datos-http/offline-first))."],
        blocks: [
          {
            t: 'code',
            lang: 'ts',
            file: 'core/services/network.service.ts',
            code: code`
              import { Injectable, signal } from '@angular/core';
              import { ConnectionStatus, Network } from '@capacitor/network';

              @Injectable({ providedIn: 'root' })
              export class NetworkService {
                readonly online = signal(true);
                readonly type = signal<ConnectionStatus['connectionType']>('unknown');

                async init(): Promise<void> {
                  this.update(await Network.getStatus());
                  await Network.addListener('networkStatusChange', (s) => this.update(s));
                }

                private update(s: ConnectionStatus): void {
                  this.online.set(s.connected);
                  this.type.set(s.connectionType);
                }
              }
            `,
          },
        ],
        pitfalls: [
          "`connected: true` no garantiza acceso a tu API (portal cautivo, VPN, backend caído): trata también el `status 0` de las peticiones.",
          "Llamar `init()` en varias páginas: listeners duplicados. Hazlo una vez (p. ej. en `AppComponent`).",
        ],
        links: [['Network', 'https://capacitorjs.com/docs/apis/network']],
      },
      {
        id: 'app',
        title: 'App: deep links, estado, back button e info',
        tags: ['@capacitor/app', 'appUrlOpen', 'App Links', 'Universal Links', 'appStateChange', 'getInfo', 'NgZone'],
        summary: "Eventos del ciclo de vida de la app, apertura por URL (deep links / universal links), back button de Android e información de versión.",
        when: [
          "Abrir una pantalla concreta desde un enlace (email, SMS, web, notificación).",
          "Refrescar sesión al volver de segundo plano; mostrar versión en Ajustes.",
        ],
        blocks: [
          {
            t: 'code',
            lang: 'ts',
            file: 'core/services/deep-link.service.ts',
            code: code`
              import { Injectable, NgZone, inject } from '@angular/core';
              import { Router } from '@angular/router';
              import { App, URLOpenListenerEvent } from '@capacitor/app';

              @Injectable({ providedIn: 'root' })
              export class DeepLinkService {
                private readonly router = inject(Router);
                private readonly zone = inject(NgZone);

                async init(): Promise<void> {
                  await App.addListener('appUrlOpen', (event: URLOpenListenerEvent) => {
                    // Run inside Angular's zone so navigation/change detection happen
                    this.zone.run(() => this.open(event.url));
                  });

                  // Cold start fallback
                  const launch = await App.getLaunchUrl();
                  if (launch?.url) this.zone.run(() => this.open(launch.url));
                }

                private open(raw: string): void {
                  const u = new URL(raw);
                  // https://pay.example.com/payments/123 → /payments/123
                  // myapp://payments/123               → /payments/123 (host is the first segment)
                  const path = u.protocol.startsWith('http') ? u.pathname : '/' + u.host + u.pathname;
                  void this.router.navigateByUrl(path + u.search);
                }
              }

              // Other App APIs
              // const { version, build, id } = await App.getInfo();
              // App.addListener('appStateChange', ({ isActive }) => …);
              // App.addListener('resume', () => …);  App.addListener('pause', () => …);
            `,
          },
          {
            t: 'tabs',
            title: 'Configurar deep links',
            tabs: [
              {
                label: 'Android',
                lang: 'xml',
                file: 'AndroidManifest.xml (dentro de la <activity> principal)',
                code: code`
                  <!-- App Links (https) — requires https://pay.example.com/.well-known/assetlinks.json -->
                  <intent-filter android:autoVerify="true">
                      <action android:name="android.intent.action.VIEW" />
                      <category android:name="android.intent.category.DEFAULT" />
                      <category android:name="android.intent.category.BROWSABLE" />
                      <data android:scheme="https" android:host="pay.example.com" />
                  </intent-filter>

                  <!-- Custom scheme: myapp://... -->
                  <intent-filter>
                      <action android:name="android.intent.action.VIEW" />
                      <category android:name="android.intent.category.DEFAULT" />
                      <category android:name="android.intent.category.BROWSABLE" />
                      <data android:scheme="myapp" />
                  </intent-filter>
                `,
              },
              {
                label: 'iOS',
                lang: 'plist',
                file: 'Info.plist',
                code: code`
                  <!-- Custom scheme -->
                  <key>CFBundleURLTypes</key>
                  <array>
                    <dict>
                      <key>CFBundleURLName</key>
                      <string>com.company.myapp</string>
                      <key>CFBundleURLSchemes</key>
                      <array>
                        <string>myapp</string>
                      </array>
                    </dict>
                  </array>

                  <!-- Universal Links: Xcode → Signing & Capabilities → Associated Domains:
                       applinks:pay.example.com
                       + https://pay.example.com/.well-known/apple-app-site-association -->
                `,
              },
              {
                label: 'Web (servidor)',
                lang: 'json',
                file: '.well-known/assetlinks.json',
                code: code`
                  [
                    {
                      "relation": ["delegate_permission/common.handle_all_urls"],
                      "target": {
                        "namespace": "android_app",
                        "package_name": "com.company.myapp",
                        "sha256_cert_fingerprints": ["AA:BB:CC:...:FF"]
                      }
                    }
                  ]
                `,
              },
            ],
          },
        ],
        pitfalls: [
          "Navegar desde el listener sin `NgZone.run` en apps con zone.js: la vista no se actualiza.",
          "`assetlinks.json` con la huella del keystore de debug y no la de Play App Signing: los App Links no se verifican en producción.",
          "Registrar `App.addListener('backButton', …)` y también usar el sistema de Ionic (ver [Botón atrás](#/navegacion/back-button-android)).",
          "No validar la ruta recibida: un deep link puede abrir pantallas internas sin autorización. Pasa por tus guards.",
        ],
        links: [
          ['App', 'https://capacitorjs.com/docs/apis/app'],
          ['Deep Links', 'https://capacitorjs.com/docs/guides/deep-links'],
        ],
      },
      {
        id: 'keyboard',
        title: 'Keyboard',
        tags: ['@capacitor/keyboard', 'keyboardWillShow', 'hide', 'resize', 'KeyboardResize', 'accessory bar'],
        summary: "Controla el teclado nativo: eventos de mostrar/ocultar (con altura), ocultarlo, barra de accesorios (iOS) y modo de redimensionado del WebView.",
        when: ["Botones fijos abajo que deben subir con el teclado, ocultar teclado tras enviar, ajustar el layout en formularios largos."],
        blocks: [
          {
            t: 'code',
            lang: 'ts',
            code: code`
              import { Keyboard, KeyboardResize } from '@capacitor/keyboard';

              await Keyboard.addListener('keyboardWillShow', (info) => {
                document.body.style.setProperty('--kb-height', info.keyboardHeight + 'px');
              });
              await Keyboard.addListener('keyboardWillHide', () => {
                document.body.style.setProperty('--kb-height', '0px');
              });

              await Keyboard.hide();                                      // e.g. after submit
              await Keyboard.setAccessoryBarVisible({ isVisible: true }); // iOS only
              await Keyboard.setResizeMode({ mode: KeyboardResize.Body }); // iOS only
            `,
          },
          {
            t: 'table',
            head: ['Config (`capacitor.config.ts` → `plugins.Keyboard`)', 'Uso'],
            rows: [
              ['`resize`', 'iOS: `native` / `body` / `ionic` / `none` (cómo se redimensiona la vista).'],
              ['`style`', 'iOS: `dark` / `light` / `default`.'],
              ['`resizeOnFullScreen`', 'Android: corrige el resize cuando la app está en pantalla completa/edge-to-edge.'],
              ['Android (manifest)', '`android:windowSoftInputMode=\"adjustResize\"` en la activity.'],
            ],
          },
          {
            t: 'note',
            kind: 'info',
            text: "Ionic también emite `ionKeyboardDidShow` / `ionKeyboardDidHide` en `window` y gestiona el scroll de `ion-content` al enfocar inputs (scroll assist).",
          },
        ],
        pitfalls: [
          "Cambiar `resize` sin probar en dispositivo: footers que saltan o quedan tapados.",
          "Usar `setResizeMode` o `setAccessoryBarVisible` en Android: no aplica.",
        ],
        links: [
          ['Keyboard', 'https://capacitorjs.com/docs/apis/keyboard'],
          ['Keyboard (Ionic)', 'https://ionicframework.com/docs/developing/keyboard'],
        ],
      },
      {
        id: 'status-bar',
        title: 'StatusBar',
        tags: ['@capacitor/status-bar', 'setStyle', 'Style.Dark', 'setBackgroundColor', 'setOverlaysWebView'],
        summary: "Estilo (iconos claros/oscuros), color de fondo (Android), overlay y visibilidad de la barra de estado.",
        when: ["Sincronizar la barra de estado con el tema claro/oscuro o con un header de color."],
        blocks: [
          {
            t: 'code',
            lang: 'ts',
            code: code`
              import { Capacitor } from '@capacitor/core';
              import { StatusBar, Style } from '@capacitor/status-bar';

              export async function applyStatusBar(dark: boolean): Promise<void> {
                if (!Capacitor.isNativePlatform()) return;
                // Style.Dark = LIGHT icons (for dark backgrounds); Style.Light = DARK icons
                await StatusBar.setStyle({ style: dark ? Style.Dark : Style.Light });
                if (Capacitor.getPlatform() === 'android') {
                  await StatusBar.setBackgroundColor({ color: dark ? '#0f1218' : '#ffffff' });
                }
              }

              // await StatusBar.setOverlaysWebView({ overlay: true }); // Android: draw under the status bar
              // await StatusBar.hide(); await StatusBar.show();
            `,
          },
        ],
        pitfalls: [
          "Confundir `Style.Dark` (texto claro) con \"tema oscuro de barra\".",
          "En Android 15+ con edge-to-edge, `setBackgroundColor`/`setOverlaysWebView` pueden no tener efecto ⚠ verificar en la doc de Capacitor 8.",
          "Llamar a StatusBar en web: lanza \"not implemented\". Protege con `isNativePlatform()`.",
        ],
        links: [['Status Bar', 'https://capacitorjs.com/docs/apis/status-bar']],
      },
      {
        id: 'splash-screen',
        title: 'SplashScreen',
        tags: ['@capacitor/splash-screen', 'launchAutoHide', 'hide', 'launchShowDuration', 'Android 12'],
        summary: "Pantalla de carga nativa. Lo recomendable: desactivar el auto-hide y ocultarla cuando la app está realmente lista.",
        when: ["Evitar el flash en blanco mientras Angular arranca y se cargan los datos iniciales."],
        blocks: [
          {
            t: 'tabs',
            tabs: [
              {
                label: 'Config',
                lang: 'ts',
                file: 'capacitor.config.ts',
                code: code`
                  plugins: {
                    SplashScreen: {
                      launchAutoHide: false,     // hide manually
                      launchShowDuration: 3000,  // safety max if autoHide were true
                      backgroundColor: '#ffffff',
                      showSpinner: false,
                      androidScaleType: 'CENTER_CROP',
                    },
                  },
                `,
              },
              {
                label: 'TypeScript',
                lang: 'ts',
                file: 'app.component.ts',
                code: code`
                  import { SplashScreen } from '@capacitor/splash-screen';

                  async ngOnInit(): Promise<void> {
                    try {
                      await this.session.restore();   // whatever your app needs first
                    } finally {
                      await SplashScreen.hide({ fadeOutDuration: 200 });
                    }
                  }
                `,
              },
            ],
          },
          {
            t: 'note',
            kind: 'info',
            text: "Android 12+ usa la Splash Screen API del sistema: muestra el icono sobre un color, no una imagen a pantalla completa. Genera recursos con [@capacitor/assets](#/build-despliegue/iconos-splash).",
          },
        ],
        pitfalls: [
          "`launchAutoHide: false` y nunca llamar `hide()` (p. ej. por un error): la app queda en el splash. Usa `finally`.",
          "Esperar a peticiones lentas antes de ocultar: mejor ocultar pronto y mostrar skeletons.",
        ],
        links: [['Splash Screen', 'https://capacitorjs.com/docs/apis/splash-screen']],
      },
      {
        id: 'push-notifications',
        title: 'Push Notifications',
        tags: ['@capacitor/push-notifications', 'FCM', 'APNs', 'register', 'registration', 'pushNotificationActionPerformed', 'createChannel'],
        summary: "Recibe notificaciones remotas (FCM en Android, APNs en iOS). Obtienes un token de registro que tu backend usa para enviar mensajes.",
        when: ["Avisos de pagos, alertas de seguridad, recordatorios desde el servidor."],
        blocks: [
          {
            t: 'code',
            lang: 'ts',
            file: 'core/services/push.service.ts',
            code: code`
              import { Injectable, NgZone, inject } from '@angular/core';
              import { Router } from '@angular/router';
              import { Capacitor } from '@capacitor/core';
              import { ActionPerformed, PushNotificationSchema, PushNotifications, Token } from '@capacitor/push-notifications';
              import { DeviceApi } from '../api/device.api';

              @Injectable({ providedIn: 'root' })
              export class PushService {
                private readonly router = inject(Router);
                private readonly zone = inject(NgZone);
                private readonly api = inject(DeviceApi);

                async init(): Promise<void> {
                  if (!Capacitor.isNativePlatform()) return;

                  let perm = await PushNotifications.checkPermissions();
                  if (perm.receive === 'prompt') perm = await PushNotifications.requestPermissions();
                  if (perm.receive !== 'granted') return;

                  // Listeners BEFORE register()
                  await PushNotifications.addListener('registration', (t: Token) => this.api.registerPushToken(t.value));
                  await PushNotifications.addListener('registrationError', (e) => console.error('Push registration', e.error));
                  await PushNotifications.addListener('pushNotificationReceived', (n: PushNotificationSchema) => {
                    // App in foreground: show an in-app toast/banner
                  });
                  await PushNotifications.addListener('pushNotificationActionPerformed', (a: ActionPerformed) => {
                    const route = a.notification.data?.route as string | undefined;
                    if (route) this.zone.run(() => void this.router.navigateByUrl(route));
                  });

                  if (Capacitor.getPlatform() === 'android') {
                    await PushNotifications.createChannel({ id: 'payments', name: 'Pagos', importance: 4 });
                  }
                  await PushNotifications.register();
                }
              }
            `,
          },
          {
            t: 'tabs',
            title: 'Configuración nativa',
            tabs: [
              {
                label: 'Android',
                blocks: [
                  {
                    t: 'list',
                    items: [
                      "Crea el proyecto en Firebase y descarga `google-services.json` en `android/app/`.",
                      "Android 13+: `requestPermissions()` pide `POST_NOTIFICATIONS`.",
                      "Icono de notificación monocromo en `res/drawable` y configúralo en `AndroidManifest.xml` (meta-data de Firebase) ⚠ verificar.",
                    ],
                  },
                ],
              },
              {
                label: 'iOS',
                blocks: [
                  {
                    t: 'list',
                    items: [
                      "Xcode → Signing & Capabilities → **Push Notifications** (y Background Modes → Remote notifications si envías silenciosas).",
                      "Crea una APNs Auth Key (.p8) en Apple Developer y súbela a tu proveedor (Firebase o el tuyo).",
                      "El token de `registration` en iOS es de **APNs**. Si tu backend usa FCM también en iOS, necesitas Firebase Messaging (p. ej. `@capacitor-firebase/messaging`).",
                    ],
                  },
                  {
                    t: 'code',
                    lang: 'swift',
                    file: 'ios/App/App/AppDelegate.swift',
                    code: code`
                      func application(_ application: UIApplication, didRegisterForRemoteNotificationsWithDeviceToken deviceToken: Data) {
                          NotificationCenter.default.post(name: .capacitorDidRegisterForRemoteNotifications, object: deviceToken)
                      }

                      func application(_ application: UIApplication, didFailToRegisterForRemoteNotificationsWithError error: Error) {
                          NotificationCenter.default.post(name: .capacitorDidFailToRegisterForRemoteNotifications, object: error)
                      }
                    `,
                  },
                ],
              },
            ],
          },
          {
            t: 'code',
            lang: 'ts',
            title: 'Mostrar notificaciones con la app en primer plano (iOS)',
            code: code`
              // capacitor.config.ts
              plugins: {
                PushNotifications: {
                  presentationOptions: ['badge', 'sound', 'alert'],
                },
              },
            `,
          },
        ],
        pitfalls: [
          "Registrar listeners después de `register()`: se pierde el evento `registration`.",
          "Probar push en el simulador de iOS antiguo o sin la capability: nunca llega el token.",
          "Enviar el token de APNs a FCM (o al revés).",
          "No actualizar el token en backend cuando cambia (reinstalación, restore).",
        ],
        links: [
          ['Push Notifications', 'https://capacitorjs.com/docs/apis/push-notifications'],
          ['Guía Firebase', 'https://capacitorjs.com/docs/guides/push-notifications-firebase'],
        ],
      },
      {
        id: 'local-notifications',
        title: 'Local Notifications',
        tags: ['@capacitor/local-notifications', 'schedule', 'allowWhileIdle', 'getPending', 'cancel', 'exact alarm'],
        summary: "Notificaciones programadas desde el propio dispositivo, sin servidor.",
        when: ["Recordatorios de vencimiento, alarmas de pago recurrente, avisos de tareas offline completadas."],
        blocks: [
          {
            t: 'code',
            lang: 'ts',
            code: code`
              import { LocalNotifications } from '@capacitor/local-notifications';

              export async function remindPayment(id: number, dueDate: Date): Promise<void> {
                const perm = await LocalNotifications.requestPermissions();
                if (perm.display !== 'granted') return;

                await LocalNotifications.schedule({
                  notifications: [
                    {
                      id,                                   // 32-bit integer, unique
                      title: 'Recordatorio de pago',
                      body: 'Tu factura vence mañana',
                      schedule: { at: new Date(dueDate.getTime() - 24 * 3600_000), allowWhileIdle: true },
                      extra: { route: '/payments/' + id },
                    },
                  ],
                });
              }

              await LocalNotifications.addListener('localNotificationActionPerformed', (a) => {
                const route = a.notification.extra?.route;
              });

              const { notifications } = await LocalNotifications.getPending();
              await LocalNotifications.cancel({ notifications: [{ id: 42 }] });
            `,
          },
          {
            t: 'note',
            kind: 'warn',
            text: "Android 12+ limita las alarmas exactas (`SCHEDULE_EXACT_ALARM`). El plugin ofrece `checkExactNotificationSetting()` / `changeExactNotificationSetting()` para gestionarlo ⚠ verificar.",
          },
        ],
        pitfalls: [
          "IDs no numéricos o mayores de 32 bits: la notificación no se programa.",
          "Programar fechas en el pasado: no se muestra nada.",
          "Olvidar el icono pequeño en Android (`smallIcon` en config): icono genérico o cuadrado blanco.",
        ],
        links: [['Local Notifications', 'https://capacitorjs.com/docs/apis/local-notifications']],
      },
      {
        id: 'share',
        title: 'Share',
        tags: ['@capacitor/share', 'share', 'canShare', 'files'],
        summary: "Abre la hoja de compartir nativa con texto, URL o archivos.",
        when: ["Compartir comprobantes, enlaces de cobro, códigos de referido."],
        blocks: [
          {
            t: 'code',
            lang: 'ts',
            code: code`
              import { Share } from '@capacitor/share';
              import { Directory, Filesystem } from '@capacitor/filesystem';

              export async function shareReceipt(pdfBase64: string, id: string): Promise<void> {
                if (!(await Share.canShare()).value) return;

                const { uri } = await Filesystem.writeFile({
                  path: 'share/receipt-' + id + '.pdf',
                  data: pdfBase64,
                  directory: Directory.Cache,
                  recursive: true,
                });

                try {
                  await Share.share({ title: 'Comprobante', text: 'Pago ' + id, files: [uri], dialogTitle: 'Compartir comprobante' });
                } catch {
                  // user cancelled the share sheet
                }
              }
            `,
          },
        ],
        pitfalls: [
          "No capturar la cancelación: aparece como error.",
          "Compartir archivos desde `Directory.Data` en Android: puede requerir FileProvider; `Cache` suele funcionar mejor ⚠ verificar.",
          "En web, `navigator.share` solo funciona en HTTPS y no en todos los navegadores de escritorio.",
        ],
        links: [['Share', 'https://capacitorjs.com/docs/apis/share']],
      },
      {
        id: 'haptics',
        title: 'Haptics',
        tags: ['@capacitor/haptics', 'impact', 'notification', 'vibrate', 'ImpactStyle'],
        summary: "Feedback háptico: impactos, notificaciones (éxito/aviso/error), vibración y selección.",
        when: ["Confirmar un pago, error de validación, cambios de selección en pickers."],
        blocks: [
          {
            t: 'code',
            lang: 'ts',
            code: code`
              import { Haptics, ImpactStyle, NotificationType } from '@capacitor/haptics';

              await Haptics.impact({ style: ImpactStyle.Light });           // Light | Medium | Heavy
              await Haptics.notification({ type: NotificationType.Success }); // Success | Warning | Error
              await Haptics.vibrate({ duration: 300 });

              await Haptics.selectionStart();
              await Haptics.selectionChanged();
              await Haptics.selectionEnd();
            `,
          },
        ],
        pitfalls: [
          "Abusar del háptico en cada toque: molesta y consume batería.",
          "Esperar haptics en web/desktop: no hay hardware; no falla, pero no hace nada útil.",
        ],
        links: [['Haptics', 'https://capacitorjs.com/docs/apis/haptics']],
      },
      {
        id: 'browser',
        title: 'Browser (navegador in-app)',
        tags: ['@capacitor/browser', 'open', 'SFSafariViewController', 'Custom Tabs', 'browserFinished'],
        summary: "Abre una URL en el navegador del sistema dentro de la app (SFSafariViewController en iOS, Chrome Custom Tabs en Android). No comparte cookies con tu WebView.",
        when: ["Términos y condiciones, ayuda, 3-D Secure o checkouts externos, flujos OAuth con retorno por deep link."],
        blocks: [
          {
            t: 'code',
            lang: 'ts',
            code: code`
              import { Browser } from '@capacitor/browser';

              await Browser.open({
                url: 'https://example.com/terms',
                presentationStyle: 'popover', // iOS: 'fullscreen' | 'popover'
                toolbarColor: '#6a3cf0',
              });

              await Browser.addListener('browserFinished', () => {
                // user closed the browser → e.g. re-check payment status
              });

              // await Browser.close(); // iOS/web
            `,
          },
          {
            t: 'note',
            kind: 'info',
            text: "Si necesitas un WebView in-app con más control (eventos de navegación, inyectar scripts), revisa `@capacitor/inappbrowser` ⚠ verificar.",
          },
        ],
        pitfalls: [
          "Abrir URLs externas dentro de tu propio WebView (`window.location`): sacas al usuario de la app sin forma de volver.",
          "Esperar compartir sesión/cookies con el WebView de la app: son contextos distintos.",
        ],
        links: [['Browser', 'https://capacitorjs.com/docs/apis/browser']],
      },
    ],
  },

  /* ===================================================================
     10. SEGURIDAD
     =================================================================== */
  {
    id: 'seguridad',
    num: 10,
    title: 'Seguridad',
    desc: "Qué no guardar en Preferences, almacenamiento seguro, biometría, SSL pinning, CSP en el WebView, detección de root/jailbreak y checklist de release.",
    topics: [
      {
        id: 'que-no-guardar',
        title: 'Qué guardar dónde (y qué no guardar en Preferences)',
        tags: ['Preferences', 'localStorage', 'tokens', 'Keychain', 'Keystore', 'secretos'],
        summary: "`Preferences`, `localStorage` e IndexedDB **no están cifrados** y son legibles en dispositivos rooteados o en backups. Los secretos van en Keychain (iOS) / Keystore (Android) mediante un plugin de almacenamiento seguro, y lo realmente secreto no debe estar en la app.",
        when: ["Antes de decidir dónde persistir tokens, PINs, datos personales o claves."],
        blocks: [
          {
            t: 'table',
            head: ['Dato', 'Dónde', 'Notas'],
            rows: [
              ['Idioma, tema, onboarding visto', '`Preferences`', 'No sensible.'],
              ['Access token (vida corta)', 'Memoria (servicio) + secure storage si debe sobrevivir', 'Nunca en `localStorage`.'],
              ['Refresh token', 'Secure storage (Keychain/Keystore)', 'Idealmente protegido por biometría.'],
              ['PAN de tarjeta, CVV', '**En ningún sitio**', 'Tokeniza con el proveedor de pagos.'],
              ['Datos personales en cache', 'SQLite cifrado o secure storage', 'Minimiza lo que guardas.'],
              ['API keys \"secretas\", client secrets', '**No en la app**', 'Todo lo que va en el bundle es extraíble. Muévelo al backend.'],
            ],
          },
          {
            t: 'note',
            kind: 'danger',
            text: "`environment.ts` se compila dentro del JS de la app: cualquiera puede descomprimir el APK/IPA y leerlo. Solo URLs y claves públicas.",
          },
        ],
        pitfalls: [
          "Guardar el JWT en `localStorage` por comodidad del interceptor.",
          "Loguear tokens o respuestas completas con `console.log` en producción (visibles con `adb logcat` / Safari).",
          "Pensar que ofuscar el JS protege secretos.",
        ],
        links: [
          ['Security (Capacitor)', 'https://capacitorjs.com/docs/guides/security'],
          ['OWASP MASVS', 'https://mas.owasp.org/MASVS/'],
        ],
      },
      {
        id: 'secure-storage',
        title: 'Almacenamiento seguro (Keychain / Keystore)',
        tags: ['secure storage', 'Keychain', 'Keystore', '@aparajita/capacitor-secure-storage', 'Identity Vault', 'TokenStore'],
        summary: "No hay plugin oficial gratuito de Capacitor para secure storage: se usan plugins comunitarios que guardan en Keychain/Keystore. Abstráelo detrás de un servicio para poder cambiar de implementación.",
        when: ["Refresh tokens, credenciales para biometría, claves de cifrado de la base local."],
        blocks: [
          {
            t: 'table',
            head: ['Opción', 'Notas'],
            rows: [
              ['`@aparajita/capacitor-secure-storage`', 'Comunitario, Keychain/Keystore, API simple ⚠ verificar compatibilidad con Capacitor 8.'],
              ['`capacitor-secure-storage-plugin`', 'Comunitario, alternativa clásica ⚠ verificar mantenimiento.'],
              ['Ionic Identity Vault', 'Comercial (Ionic Enterprise) ⚠ verificar disponibilidad actual del producto.'],
            ],
          },
          {
            t: 'code',
            lang: 'ts',
            file: 'core/security/token.store.ts',
            code: code`
              import { Injectable } from '@angular/core';
              import { Capacitor } from '@capacitor/core';
              // ⚠ verify the exact API of the plugin version you install
              import { SecureStorage } from '@aparajita/capacitor-secure-storage';

              const REFRESH_KEY = 'auth.refresh';

              @Injectable({ providedIn: 'root' })
              export class TokenStore {
                private accessToken: string | null = null; // memory only

                getAccessToken(): Promise<string | null> {
                  return Promise.resolve(this.accessToken);
                }

                setAccessToken(token: string | null): void {
                  this.accessToken = token;
                }

                async getRefreshToken(): Promise<string | null> {
                  if (!Capacitor.isNativePlatform()) return null; // never persist secrets on web
                  return (await SecureStorage.get(REFRESH_KEY)) as string | null;
                }

                async setRefreshToken(token: string): Promise<void> {
                  if (Capacitor.isNativePlatform()) await SecureStorage.set(REFRESH_KEY, token);
                }

                async clear(): Promise<void> {
                  this.accessToken = null;
                  if (Capacitor.isNativePlatform()) await SecureStorage.remove(REFRESH_KEY);
                }
              }
            `,
          },
        ],
        pitfalls: [
          "Implementación web que \"simula\" secure storage con `localStorage`: en web no hay almacenamiento seguro.",
          "Asumir que los datos del Keychain se borran al desinstalar en iOS: pueden persistir; límpialos en el primer arranque si hace falta.",
          "Acoplar todas las páginas al plugin: si deja de mantenerse, el cambio es masivo.",
        ],
        links: [
          ['Security (Capacitor)', 'https://capacitorjs.com/docs/guides/security'],
          ['Community plugins', 'https://github.com/capacitor-community'],
        ],
      },
      {
        id: 'biometria',
        title: 'Biometría (Face ID / huella)',
        tags: ['biometría', 'Face ID', 'Touch ID', 'BiometricPrompt', 'NSFaceIDUsageDescription', '@aparajita/capacitor-biometric-auth'],
        summary: "Se implementa con plugins comunitarios sobre BiometricPrompt (Android) y LocalAuthentication (iOS). Un simple \"sí/no\" biométrico solo protege la UI; la protección real es liberar un secreto del Keychain/Keystore tras autenticar.",
        when: ["Desbloqueo rápido de la app, confirmar transferencias o pagos."],
        blocks: [
          {
            t: 'code',
            lang: 'ts',
            code: code`
              // ⚠ verify API for your plugin/version (example based on @aparajita/capacitor-biometric-auth)
              import { BiometricAuth } from '@aparajita/capacitor-biometric-auth';

              export async function confirmWithBiometrics(reason: string): Promise<boolean> {
                const info = await BiometricAuth.checkBiometry();
                if (!info.isAvailable) return false; // fall back to PIN/password

                try {
                  await BiometricAuth.authenticate({
                    reason,                         // iOS prompt text
                    cancelTitle: 'Cancelar',
                    allowDeviceCredential: true,    // allow device PIN as fallback
                    androidTitle: 'Confirmar pago',
                  });
                  return true;
                } catch {
                  return false; // cancelled, locked out or failed
                }
              }
            `,
          },
          {
            t: 'tabs',
            tabs: [
              {
                label: 'iOS',
                lang: 'plist',
                file: 'Info.plist',
                code: code`
                  <key>NSFaceIDUsageDescription</key>
                  <string>Usamos Face ID para confirmar tus pagos.</string>
                `,
              },
              {
                label: 'Android',
                lang: 'xml',
                file: 'AndroidManifest.xml',
                code: code`
                  <!-- Usually merged from the plugin manifest; add it if your plugin requires it -->
                  <uses-permission android:name="android.permission.USE_BIOMETRIC" />
                `,
              },
            ],
          },
        ],
        pitfalls: [
          "Considerar el `true` biométrico como autorización en el backend: el servidor no puede verificarlo. Usa claves protegidas por biometría o step-up auth.",
          "Falta `NSFaceIDUsageDescription`: la app se cierra al usar Face ID.",
          "No ofrecer alternativa (PIN/contraseña) cuando no hay biometría o está bloqueada.",
        ],
        links: [
          ['Android BiometricPrompt', 'https://developer.android.com/identity/sign-in/biometric-auth'],
          ['iOS LocalAuthentication', 'https://developer.apple.com/documentation/localauthentication'],
        ],
      },
      {
        id: 'ssl-pinning',
        title: 'SSL / certificate pinning',
        tags: ['SSL pinning', 'network_security_config', 'pin-set', 'NSPinnedDomains', 'SPKI', 'MITM'],
        summary: "Pinning limita qué certificados acepta la app para tu API, mitigando MITM con CAs instaladas por el usuario. Se configura en la capa nativa; asegúrate de que tus peticiones realmente pasan por esa capa.",
        when: ["Apps financieras o con requisitos regulatorios (MASVS-NETWORK)."],
        blocks: [
          {
            t: 'tabs',
            tabs: [
              {
                label: 'Android',
                lang: 'xml',
                file: 'android/app/src/main/res/xml/network_security_config.xml',
                code: code`
                  <?xml version="1.0" encoding="utf-8"?>
                  <network-security-config>
                      <base-config cleartextTrafficPermitted="false" />
                      <domain-config>
                          <domain includeSubdomains="true">api.example.com</domain>
                          <!-- Always include a BACKUP pin and an expiration -->
                          <pin-set expiration="2027-06-30">
                              <pin digest="SHA-256">PRIMARY_SPKI_BASE64=</pin>
                              <pin digest="SHA-256">BACKUP_SPKI_BASE64=</pin>
                          </pin-set>
                      </domain-config>
                  </network-security-config>

                  <!-- AndroidManifest.xml → <application android:networkSecurityConfig="@xml/network_security_config" ...> -->
                `,
              },
              {
                label: 'iOS',
                lang: 'plist',
                file: 'Info.plist',
                code: code`
                  <key>NSAppTransportSecurity</key>
                  <dict>
                    <key>NSPinnedDomains</key>
                    <dict>
                      <key>api.example.com</key>
                      <dict>
                        <key>NSIncludesSubdomains</key>
                        <true/>
                        <key>NSPinnedLeafIdentities</key>
                        <array>
                          <dict>
                            <key>SPKI-SHA256-BASE64</key>
                            <string>PRIMARY_SPKI_BASE64=</string>
                          </dict>
                          <dict>
                            <key>SPKI-SHA256-BASE64</key>
                            <string>BACKUP_SPKI_BASE64=</string>
                          </dict>
                        </array>
                      </dict>
                    </dict>
                  </dict>
                `,
              },
              {
                label: 'Obtener el pin',
                lang: 'bash',
                code: code`
                  openssl s_client -connect api.example.com:443 -servername api.example.com </dev/null \
                    | openssl x509 -pubkey -noout \
                    | openssl pkey -pubin -outform der \
                    | openssl dgst -sha256 -binary \
                    | openssl base64
                `,
              },
            ],
          },
          {
            t: 'note',
            kind: 'warn',
            text: "Estas configuraciones aplican al stack HTTP **nativo** (p. ej. `CapacitorHttp`, que usa HttpURLConnection/URLSession). Si las peticiones salen desde el WebView (`HttpClient` sin CapacitorHttp), comprueba en dispositivo con un proxy (mitmproxy/Charles) que el pinning se aplica ⚠ verificar.",
          },
        ],
        pitfalls: [
          "Sin pin de respaldo: al rotar el certificado la app deja de funcionar hasta publicar una actualización.",
          "Pinear el certificado hoja completo en vez del SPKI: cada renovación rompe la app.",
          "Probar solo en debug: verifica en release con un proxy MITM que la conexión se rechaza.",
        ],
        links: [
          ['Android Network Security Config', 'https://developer.android.com/privacy-and-security/security-config'],
          ['Apple: Identity Pinning', 'https://developer.apple.com/news/?id=g9ejcf8y'],
          ['OWASP Pinning', 'https://mas.owasp.org/MASTG/'],
        ],
      },
      {
        id: 'csp-webview',
        title: 'Content Security Policy en el WebView',
        tags: ['CSP', 'Content-Security-Policy', 'meta', 'connect-src', 'unsafe-inline', 'XSS'],
        summary: "Una CSP en `src/index.html` limita qué scripts, estilos y conexiones puede usar la app, mitigando XSS. El origen de la app (`https://localhost` / `capacitor://localhost`) es `'self'`.",
        when: ["Siempre en producción; especialmente si muestras HTML/contenido de terceros."],
        blocks: [
          {
            t: 'code',
            lang: 'html',
            file: 'src/index.html',
            code: code`
              <!-- frame-ancestors / report-uri are ignored in <meta>; set them as HTTP headers for the PWA -->
              <meta http-equiv="Content-Security-Policy" content="
                default-src 'self';
                script-src 'self';
                style-src 'self' 'unsafe-inline';
                img-src 'self' data: blob: https://cdn.example.com;
                font-src 'self' data:;
                connect-src 'self' https://api.example.com;
                media-src 'self' blob:;
                object-src 'none';
                base-uri 'self';
                form-action 'self'
              ">
            `,
          },
          {
            t: 'table',
            head: ['Directiva', 'Por qué'],
            rows: [
              ['`style-src \'unsafe-inline\'`', 'Ionic (Stencil) y Angular inyectan estilos en tiempo de ejecución. Sin él, componentes sin estilo ⚠ verificar si tu versión soporta nonce/hashes (Angular `autoCsp`).'],
              ['`connect-src`', 'Lista blanca de APIs. Live reload necesita además `ws:`/`http://<ip>:8100` → usa una CSP distinta en dev.'],
              ['`img-src data: blob:`', 'Imágenes en base64 y de la cámara/archivos.'],
              ['`script-src \'self\'`', 'Sin `unsafe-eval` ni scripts inline.'],
            ],
          },
        ],
        pitfalls: [
          "Copiar una CSP de web sin `connect-src` a tu API: todas las peticiones fallan en el dispositivo.",
          "Dejar `connect-src *` \"para que funcione\": anula gran parte del beneficio.",
          "Usar `[innerHTML]` con HTML de usuario confiando en la CSP: Angular sanitiza, pero no desactives el sanitizador (`bypassSecurityTrustHtml`).",
        ],
        links: [
          ['CSP (MDN)', 'https://developer.mozilla.org/docs/Web/HTTP/CSP'],
          ['Angular Security', 'https://angular.dev/best-practices/security'],
        ],
      },
      {
        id: 'root-jailbreak',
        title: 'Detección de root / jailbreak e integridad',
        tags: ['root', 'jailbreak', 'Play Integrity', 'App Attest', 'DeviceCheck', 'tampering'],
        summary: "La detección en cliente (archivos de su, Cydia, etc.) es fácil de evadir. Lo robusto es la **atestación verificada en servidor**: Play Integrity API (Android) y App Attest / DeviceCheck (iOS).",
        when: ["Apps financieras: bloquear o limitar operaciones de riesgo en dispositivos comprometidos."],
        blocks: [
          {
            t: 'list',
            ordered: true,
            items: [
              "La app pide al servidor un `nonce` de un solo uso.",
              "La app obtiene un token de integridad nativo (Play Integrity / App Attest) incluyendo ese nonce (plugin comunitario o [plugin propio](#/plugins-custom/crear-plugin)).",
              "El backend valida el token con Google/Apple y decide (permitir, step-up auth, bloquear).",
              "Como capa adicional y no única: chequeos locales de root/jailbreak con un plugin comunitario ⚠ verificar mantenimiento antes de adoptarlo.",
            ],
          },
        ],
        pitfalls: [
          "Bloquear solo en cliente: un atacante parchea el `if`.",
          "Bloquear agresivamente a todos los rooteados sin plan de soporte: falsos positivos (ROMs custom, emuladores de QA).",
        ],
        links: [
          ['Play Integrity API', 'https://developer.android.com/google/play/integrity'],
          ['App Attest', 'https://developer.apple.com/documentation/devicecheck/establishing-your-app-s-integrity'],
        ],
      },
      {
        id: 'checklist-seguridad',
        title: 'Checklist de seguridad para release',
        tags: ['checklist', 'release', 'R8', 'allowBackup', 'webContentsDebugging', 'FLAG_SECURE'],
        summary: "Lista rápida de verificaciones antes de publicar una app con datos sensibles.",
        when: ["Antes de cada release a tiendas."],
        blocks: [
          {
            t: 'table',
            head: ['Punto', 'Cómo'],
            rows: [
              ['Sin `server.url` ni `cleartext` en config', 'Revisa `capacitor.config.ts` y `capacitor.config.json` generado.'],
              ['Solo HTTPS', '`cleartextTrafficPermitted=\"false\"`; ATS activo en iOS.'],
              ['Debug del WebView desactivado en release', 'Capacitor lo habilita solo en builds debug por defecto; revisa `android.webContentsDebuggingEnabled` / `ios.webContentsDebuggingEnabled`.'],
              ['Backups', '`android:allowBackup=\"false\"` o reglas de backup que excluyan datos sensibles.'],
              ['Minificación nativa', '`minifyEnabled true` (R8) en `release` + reglas ProGuard de plugins.'],
              ['Capturas de pantalla', 'Ocultar contenido sensible en multitarea / `FLAG_SECURE` (plugin) ⚠ verificar.'],
              ['Logs', 'Sin `console.log` de datos sensibles (usa un logger con niveles).'],
              ['Dependencias', '`npm audit`, plugins mantenidos, versiones fijadas.'],
              ['Sesión', 'Expiración, refresh rotativo, logout que limpia secure storage.'],
            ],
          },
        ],
        pitfalls: [
          "Release firmada con la config de live reload.",
          "Activar R8 sin probar: plugins que usan reflexión fallan en runtime si faltan reglas.",
        ],
        links: [
          ['Security (Capacitor)', 'https://capacitorjs.com/docs/guides/security'],
          ['OWASP MASTG', 'https://mas.owasp.org/MASTG/'],
        ],
      },
    ],
  },

  /* ===================================================================
     11. DATOS Y HTTP
     =================================================================== */
  {
    id: 'datos-http',
    num: 11,
    title: 'Datos y HTTP',
    desc: "`HttpClient` frente a `CapacitorHttp` (CORS en dispositivo), interceptores, el patrón `ServiceResult<T>`, offline-first y SQLite.",
    topics: [
      {
        id: 'httpclient-vs-capacitorhttp',
        title: '`HttpClient` frente a `CapacitorHttp` (CORS)',
        tags: ['HttpClient', 'CapacitorHttp', 'CORS', 'CapacitorCookies', 'native http'],
        summary: "`HttpClient` hace las peticiones desde el WebView (sujeto a CORS y cookies del WebView). `CapacitorHttp` las hace desde código nativo (sin CORS). Activándolo en la config, parchea `fetch`/XHR y tu `HttpClient` pasa a ser nativo sin cambiar código.",
        when: [
          "No controlas el backend y no puedes configurar CORS para `https://localhost` / `capacitor://localhost`.",
          "Necesitas pinning nativo o cookies de terceros.",
        ],
        blocks: [
          {
            t: 'tabs',
            tabs: [
              {
                label: 'Config (parcheo global)',
                lang: 'ts',
                file: 'capacitor.config.ts',
                code: code`
                  plugins: {
                    CapacitorHttp: { enabled: true },     // fetch/XHR go through native code
                    CapacitorCookies: { enabled: true },  // document.cookie via native cookie store
                  },
                `,
              },
              {
                label: 'Uso directo',
                lang: 'ts',
                code: code`
                  import { CapacitorHttp, HttpResponse } from '@capacitor/core';

                  const res: HttpResponse = await CapacitorHttp.get({
                    url: 'https://api.example.com/rates',
                    headers: { Accept: 'application/json' },
                    params: { currency: 'USD' },
                  });
                  console.log(res.status, res.data, res.headers);
                `,
              },
            ],
          },
          {
            t: 'table',
            head: ['', '`HttpClient` (WebView)', '`CapacitorHttp` (nativo)'],
            rows: [
              ['CORS', 'Sí: el backend debe permitir el origen de la app.', 'No aplica.'],
              ['Interceptores Angular', 'Sí.', 'Sí, si está parcheado (siguen corriendo en Angular).'],
              ['Progreso de subida/descarga', 'Sí (`reportProgress`).', 'Limitado ⚠ verificar.'],
              ['FormData / Blob grandes', 'Sí.', 'Revisa limitaciones en la doc ⚠ verificar.'],
              ['Funciona en `ionic serve`', 'Sí.', 'En web vuelve a `fetch` normal (con CORS).'],
            ],
          },
          {
            t: 'note',
            kind: 'ok',
            text: "La solución más limpia suele ser **configurar CORS en el backend** para `https://localhost`, `capacitor://localhost` y `http://localhost:8100`. Ejemplo para ASP.NET Core y Spring en [CORS en dispositivo](#/troubleshooting/cors-dispositivo).",
          },
        ],
        pitfalls: [
          "Activar `CapacitorHttp` para \"arreglar CORS\" y seguir viendo CORS en `ionic serve`: en web no aplica.",
          "Mezclar llamadas directas a `CapacitorHttp` con `HttpClient`: duplicas manejo de errores y auth.",
        ],
        links: [
          ['CapacitorHttp', 'https://capacitorjs.com/docs/apis/http'],
          ['CapacitorCookies', 'https://capacitorjs.com/docs/apis/cookies'],
        ],
      },
      {
        id: 'service-result',
        title: 'Patrón `ServiceResult<T>` con `observe: \'response\'`',
        tags: ['ServiceResult', 'observe response', 'HttpResponse', 'HttpErrorResponse', 'status code', 'ProblemDetails'],
        summary: "Todos los servicios HTTP devuelven `Observable<ServiceResult<T>>` con `ok`, `status`, `data` y `error`. Se pide la respuesta completa con `observe: 'response'` y se normalizan los errores en un único sitio: las páginas nunca reciben excepciones HTTP.",
        when: ["En todos los servicios que hablan con tu API (convención del proyecto)."],
        blocks: [
          {
            t: 'code',
            lang: 'ts',
            file: 'core/http/service-result.ts',
            code: code`
              import { HttpErrorResponse, HttpResponse } from '@angular/common/http';
              import { Observable, TimeoutError, catchError, map, of } from 'rxjs';

              export interface ApiError {
                code?: string;
                message: string;
                details?: unknown; // e.g. ASP.NET ProblemDetails.errors
              }

              export interface ServiceResult<T> {
                ok: boolean;
                status: number;         // HTTP status; 0 = network/CORS/timeout
                data: T | null;
                error: ApiError | null;
              }

              export function toServiceResult<T>(source: Observable<HttpResponse<T>>): Observable<ServiceResult<T>> {
                return source.pipe(
                  map((res): ServiceResult<T> => ({ ok: true, status: res.status, data: res.body, error: null })),
                  catchError((err: unknown) => of(fromError<T>(err))),
                );
              }

              function fromError<T>(err: unknown): ServiceResult<T> {
                if (err instanceof TimeoutError) {
                  return { ok: false, status: 0, data: null, error: { code: 'TIMEOUT', message: 'Tiempo de espera agotado' } };
                }
                if (err instanceof HttpErrorResponse) {
                  const body = typeof err.error === 'object' && err.error !== null ? err.error : {};
                  // Supports ASP.NET Core ProblemDetails (title/detail) and { code, message }
                  const message =
                    body.message ?? body.detail ?? body.title ??
                    (err.status === 0 ? 'Sin conexión con el servidor' : 'Error inesperado (' + err.status + ')');
                  return {
                    ok: false,
                    status: err.status,
                    data: null,
                    error: { code: body.code, message, details: body.errors ?? body },
                  };
                }
                return { ok: false, status: -1, data: null, error: { message: String(err) } };
              }
            `,
          },
          {
            t: 'tabs',
            tabs: [
              {
                label: 'Servicio',
                lang: 'ts',
                file: 'core/services/payment.service.ts',
                code: code`
                  import { Injectable, inject } from '@angular/core';
                  import { HttpClient, HttpParams } from '@angular/common/http';
                  import { Observable, firstValueFrom } from 'rxjs';
                  import { environment } from '../../../environments/environment';
                  import { ServiceResult, toServiceResult } from '../http/service-result';

                  export interface Payment { id: string; merchant: string; amount: number; date: string; }
                  export interface Page<T> { items: T[]; hasMore: boolean; }

                  @Injectable({ providedIn: 'root' })
                  export class PaymentService {
                    private readonly http = inject(HttpClient);
                    private readonly url = environment.apiUrl + '/payments';

                    list(page = 1, size = 20): Observable<ServiceResult<Page<Payment>>> {
                      const params = new HttpParams().set('page', page).set('size', size);
                      return toServiceResult(this.http.get<Page<Payment>>(this.url, { params, observe: 'response' }));
                    }

                    getById(id: string): Observable<ServiceResult<Payment>> {
                      return toServiceResult(this.http.get<Payment>(this.url + '/' + id, { observe: 'response' }));
                    }

                    create(body: Omit<Payment, 'id'>): Observable<ServiceResult<Payment>> {
                      return toServiceResult(this.http.post<Payment>(this.url, body, { observe: 'response' }));
                    }

                    remove(id: string): Observable<ServiceResult<void>> {
                      return toServiceResult(this.http.delete<void>(this.url + '/' + id, { observe: 'response' }));
                    }

                    // Promise flavor for async/await in pages
                    listAsync(page = 1): Promise<ServiceResult<Page<Payment>>> {
                      return firstValueFrom(this.list(page));
                    }
                  }
                `,
              },
              {
                label: 'Uso en página',
                lang: 'ts',
                code: code`
                  readonly payment = signal<Payment | null>(null);
                  readonly notFound = signal(false);

                  async ionViewWillEnter(): Promise<void> {
                    const res = await firstValueFrom(this.payments.getById(this.id()));
                    if (res.ok) {
                      this.payment.set(res.data);
                      return;
                    }
                    switch (res.status) {
                      case 404: this.notFound.set(true); break;
                      case 401: /* handled by interceptor (logout) */ break;
                      case 0: await this.ui.toast('Sin conexión', 'warning'); break;
                      default: await this.ui.toast(res.error?.message ?? 'Error', 'danger');
                    }
                  }
                `,
              },
              {
                label: 'Test',
                lang: 'ts',
                code: code`
                  it('maps 404 to ServiceResult', async () => {
                    const promise = firstValueFrom(service.getById('x'));
                    httpMock.expectOne(environment.apiUrl + '/payments/x')
                      .flush({ title: 'Not found' }, { status: 404, statusText: 'Not Found' });
                    const res = await promise;
                    expect(res).toEqual(jasmine.objectContaining({ ok: false, status: 404, data: null }));
                    expect(res.error?.message).toBe('Not found');
                  });
                `,
              },
            ],
          },
        ],
        pitfalls: [
          "Olvidar `observe: 'response'`: obtienes solo el body y no el status.",
          "Lanzar excepciones desde el servicio \"además\" del ServiceResult: las páginas vuelven a necesitar try/catch.",
          "Tratar `ok: true` con `data: null` (204) como error.",
          "No distinguir `status 0` (red/CORS/timeout) de errores del servidor en los mensajes al usuario.",
        ],
        links: [
          ['HttpClient: leer la respuesta completa', 'https://angular.dev/guide/http/making-requests#reading-the-full-response'],
          ['ProblemDetails (ASP.NET Core)', 'https://learn.microsoft.com/aspnet/core/web-api/handle-errors'],
        ],
      },
      {
        id: 'interceptores',
        title: 'Interceptores funcionales (auth, errores, timeout)',
        tags: ['HttpInterceptorFn', 'withInterceptors', 'Authorization', '401', 'timeout', 'retry'],
        summary: "Con standalone se registran interceptores funcionales con `provideHttpClient(withInterceptors([...]))`. Pueden usar `inject()` y operar de forma async (token desde secure storage).",
        when: ["Añadir el token, idioma y versión de app; manejar 401 global; timeouts y reintentos de GET."],
        blocks: [
          {
            t: 'code',
            lang: 'ts',
            file: 'core/http/interceptors.ts',
            code: code`
              import { HttpErrorResponse, HttpInterceptorFn } from '@angular/common/http';
              import { inject } from '@angular/core';
              import { catchError, from, retry, switchMap, throwError, timeout } from 'rxjs';
              import { environment } from '../../../environments/environment';
              import { TokenStore } from '../security/token.store';
              import { SessionService } from '../services/session.service';

              export const authInterceptor: HttpInterceptorFn = (req, next) => {
                if (!req.url.startsWith(environment.apiUrl)) return next(req); // never leak the token
                const tokens = inject(TokenStore);
                return from(tokens.getAccessToken()).pipe(
                  switchMap((token) =>
                    next(
                      req.clone({
                        setHeaders: {
                          ...(token ? { Authorization: 'Bearer ' + token } : {}),
                          'Accept-Language': 'es',
                          'X-App-Version': environment.appVersion,
                        },
                      }),
                    ),
                  ),
                );
              };

              export const resilienceInterceptor: HttpInterceptorFn = (req, next) => {
                const session = inject(SessionService);
                const isIdempotent = req.method === 'GET' || req.method === 'HEAD';
                return next(req).pipe(
                  timeout(20_000),
                  retry({ count: isIdempotent ? 2 : 0, delay: 800 }),
                  catchError((err: unknown) => {
                    if (err instanceof HttpErrorResponse && err.status === 401) session.expire(); // logout + navigateRoot
                    return throwError(() => err); // ServiceResult maps it later
                  }),
                );
              };

              // main.ts
              // provideHttpClient(withInterceptors([authInterceptor, resilienceInterceptor]))
            `,
          },
        ],
        pitfalls: [
          "Reintentar POST de pagos: riesgo de cobro doble. Reintenta solo idempotentes (o usa idempotency keys).",
          "Añadir el token a cualquier URL (CDNs, terceros).",
          "Orden de interceptores: se ejecutan en el orden del array para la petición y en orden inverso para la respuesta.",
          "Refresh de token concurrente: varias peticiones con 401 disparan varios refresh. Comparte el refresh en curso (`shareReplay`).",
        ],
        links: [['Interceptores (Angular)', 'https://angular.dev/guide/http/interceptors']],
      },
      {
        id: 'offline-first',
        title: 'Offline-first: cache local y cola de sincronización',
        tags: ['offline', 'cache', 'outbox', 'sync', 'stale-while-revalidate', 'idempotency'],
        summary: "Lee primero de la cache local y actualiza desde la red cuando hay conexión (stale-while-revalidate). Las escrituras offline se encolan (outbox) y se envían al reconectar, con una clave de idempotencia.",
        when: ["Usuarios con conectividad intermitente (campo, transporte), formularios que no deben perderse."],
        blocks: [
          {
            t: 'code',
            lang: 'ts',
            file: 'core/offline/outbox.service.ts',
            code: code`
              import { Injectable, effect, inject } from '@angular/core';
              import { HttpClient } from '@angular/common/http';
              import { firstValueFrom } from 'rxjs';
              import { SettingsStore } from '../services/settings.store';
              import { NetworkService } from '../services/network.service';
              import { toServiceResult } from '../http/service-result';

              interface PendingOp {
                id: string;            // idempotency key (crypto.randomUUID())
                method: 'POST' | 'PUT' | 'DELETE';
                url: string;
                body?: unknown;
                createdAt: number;
              }

              @Injectable({ providedIn: 'root' })
              export class OutboxService {
                private readonly http = inject(HttpClient);
                private readonly store = inject(SettingsStore);   // use SQLite for large queues
                private readonly net = inject(NetworkService);
                private flushing = false;

                constructor() {
                  effect(() => {
                    if (this.net.online()) void this.flush();
                  });
                }

                async enqueue(op: Omit<PendingOp, 'id' | 'createdAt'>): Promise<void> {
                  const queue = await this.store.get<PendingOp[]>('outbox', []);
                  queue.push({ ...op, id: crypto.randomUUID(), createdAt: Date.now() });
                  await this.store.set('outbox', queue);
                }

                async flush(): Promise<void> {
                  if (this.flushing) return;
                  this.flushing = true;
                  try {
                    let queue = await this.store.get<PendingOp[]>('outbox', []);
                    for (const op of [...queue]) {
                      const res = await firstValueFrom(
                        toServiceResult(
                          this.http.request(op.method, op.url, {
                            body: op.body,
                            headers: { 'Idempotency-Key': op.id },
                            observe: 'response',
                          }),
                        ),
                      );
                      if (res.status === 0) break;                 // still offline: keep order, retry later
                      queue = queue.filter((q) => q.id !== op.id); // done (or permanent 4xx: log it)
                      await this.store.set('outbox', queue);
                    }
                  } finally {
                    this.flushing = false;
                  }
                }
              }
            `,
          },
          {
            t: 'list',
            title: 'Reglas',
            items: [
              "Cache de lectura: guarda la última respuesta por recurso con fecha; muéstrala al instante y refresca en segundo plano.",
              "Marca en la UI qué datos son \"pendientes de sincronizar\".",
              "El backend debe aceptar `Idempotency-Key` para no duplicar operaciones reintentadas.",
              "Resolución de conflictos definida (última escritura gana, versión/ETag, o manual).",
            ],
          },
        ],
        pitfalls: [
          "Cola en memoria: se pierde al cerrar la app.",
          "Reintentar en bucle errores 4xx permanentes: bloquean la cola.",
          "Encolar pagos sin idempotencia: cobros duplicados al reconectar.",
        ],
        links: [
          ['Network', 'https://capacitorjs.com/docs/apis/network'],
          ['Offline (web.dev)', 'https://web.dev/learn/pwa/offline-data'],
        ],
      },
      {
        id: 'sqlite',
        title: 'SQLite (`@capacitor-community/sqlite`)',
        tags: ['SQLite', '@capacitor-community/sqlite', 'SQLiteConnection', 'query', 'run', 'cifrado', 'jeep-sqlite'],
        summary: "Base de datos relacional local en Android/iOS (y en web con `jeep-sqlite` + WASM). Ideal para datos estructurados y volúmenes medianos/grandes.",
        when: ["Cache offline de listas grandes, outbox, catálogos; cuando Preferences se queda corto."],
        blocks: [
          {
            t: 'code',
            lang: 'bash',
            code: code`
              npm install @capacitor-community/sqlite
              npx cap sync
              # Web support (optional): npm install jeep-sqlite sql.js + copy sql-wasm.wasm to assets ⚠ verify steps
            `,
          },
          {
            t: 'code',
            lang: 'ts',
            file: 'core/db/database.service.ts',
            code: code`
              import { Injectable } from '@angular/core';
              import { CapacitorSQLite, SQLiteConnection, SQLiteDBConnection } from '@capacitor-community/sqlite';

              const SCHEMA = [
                'CREATE TABLE IF NOT EXISTS payments (id TEXT PRIMARY KEY, merchant TEXT NOT NULL, amount REAL NOT NULL, date TEXT NOT NULL, synced INTEGER DEFAULT 0);',
                'CREATE INDEX IF NOT EXISTS idx_payments_date ON payments(date);',
              ].join('\n');

              @Injectable({ providedIn: 'root' })
              export class DatabaseService {
                private readonly sqlite = new SQLiteConnection(CapacitorSQLite);
                private db?: SQLiteDBConnection;

                async init(): Promise<void> {
                  // (name, encrypted, mode, version, readonly) ⚠ verify signature for your plugin version
                  this.db = await this.sqlite.createConnection('app', false, 'no-encryption', 1, false);
                  await this.db.open();
                  await this.db.execute(SCHEMA);
                }

                async upsertPayment(p: { id: string; merchant: string; amount: number; date: string }): Promise<void> {
                  await this.db!.run(
                    'INSERT OR REPLACE INTO payments (id, merchant, amount, date) VALUES (?, ?, ?, ?)',
                    [p.id, p.merchant, p.amount, p.date],
                  );
                }

                async latest(limit = 50) {
                  const res = await this.db!.query('SELECT * FROM payments ORDER BY date DESC LIMIT ?', [limit]);
                  return res.values ?? [];
                }
              }
            `,
          },
        ],
        pitfalls: [
          "Concatenar valores en el SQL: usa siempre parámetros `?`.",
          "Abrir conexiones en cada consulta sin cerrarlas: \"connection already exists\". Usa un servicio singleton.",
          "Datos sensibles en SQLite sin cifrar: el plugin soporta cifrado (SQLCipher) con clave en secure storage ⚠ verificar configuración.",
          "Migraciones manuales sin versión: usa la API de upgrade del plugin o una tabla de versión.",
        ],
        links: [
          ['@capacitor-community/sqlite', 'https://github.com/capacitor-community/sqlite'],
          ['Storage (Capacitor guía)', 'https://capacitorjs.com/docs/guides/storage'],
        ],
      },
    ],
  },

  /* ===================================================================
     12. PLUGINS CUSTOM
     =================================================================== */
  {
    id: 'plugins-custom',
    num: 12,
    title: 'Plugins custom',
    desc: "Crear un plugin de Capacitor básico: API TypeScript, implementación Android (Kotlin/Java), iOS (Swift) y registro de código nativo local.",
    topics: [
      {
        id: 'crear-plugin',
        title: 'Crear un plugin con el generador oficial',
        tags: ['npm init @capacitor/plugin', 'plugin', 'estructura', 'registerPlugin'],
        summary: "`npm init @capacitor/plugin@latest` genera un paquete con la API TS, implementación web y proyectos nativos Android/iOS listos para compilar.",
        when: [
          "Necesitas una API nativa sin plugin existente (SDK de un banco, lector NFC propio, Play Integrity…).",
          "Quieres reutilizar el código nativo en varias apps.",
        ],
        blocks: [
          {
            t: 'code',
            lang: 'bash',
            code: code`
              npm init @capacitor/plugin@latest
              # prompts: npm package name, plugin class name (e.g. DeviceSecurity), package id, repo, author...

              cd capacitor-device-security
              npm run build

              # Use it from your app (local path during development)
              cd ../my-app
              npm install ../capacitor-device-security
              npx cap sync
            `,
          },
          {
            t: 'code',
            lang: 'text',
            title: 'Estructura generada (aprox.)',
            code: code`
              capacitor-device-security/
              ├── src/
              │   ├── definitions.ts     # TS interface (the contract)
              │   ├── index.ts           # registerPlugin(...)
              │   └── web.ts             # web implementation
              ├── android/src/main/java/.../DeviceSecurityPlugin.(kt|java)
              ├── ios/Sources/...        # Swift sources (SPM layout; ⚠ verify for your version)
              ├── package.json
              └── *.podspec / Package.swift
            `,
          },
        ],
        pitfalls: [
          "Nombres distintos entre `registerPlugin('X')`, `@CapacitorPlugin(name = \"X\")` y `jsName = \"X\"`: \"plugin is not implemented\".",
          "Olvidar `npx cap sync` tras instalar o modificar el plugin.",
          "Mezclar el major de `@capacitor/core` del plugin con el de la app.",
        ],
        links: [
          ['Creating Plugins', 'https://capacitorjs.com/docs/plugins/creating-plugins'],
          ['Plugin development workflow', 'https://capacitorjs.com/docs/plugins/workflow'],
        ],
      },
      {
        id: 'plugin-ts',
        title: 'API TypeScript y web',
        tags: ['definitions.ts', 'registerPlugin', 'WebPlugin', 'unimplemented', 'addListener'],
        summary: "La interfaz en `definitions.ts` es el contrato; `registerPlugin` crea el proxy y carga la implementación web solo en navegador.",
        when: ["Siempre: define primero la API TS y luego impleméntala en cada plataforma."],
        blocks: [
          {
            t: 'tabs',
            tabs: [
              {
                label: 'definitions.ts',
                lang: 'ts',
                code: code`
                  import type { PluginListenerHandle } from '@capacitor/core';

                  export interface DeviceSecurityPlugin {
                    echo(options: { value: string }): Promise<{ value: string }>;
                    isDeviceSecure(): Promise<{ secure: boolean }>;
                    addListener(
                      eventName: 'statusChange',
                      listener: (event: { secure: boolean }) => void,
                    ): Promise<PluginListenerHandle>;
                  }
                `,
              },
              {
                label: 'index.ts',
                lang: 'ts',
                code: code`
                  import { registerPlugin } from '@capacitor/core';
                  import type { DeviceSecurityPlugin } from './definitions';

                  const DeviceSecurity = registerPlugin<DeviceSecurityPlugin>('DeviceSecurity', {
                    web: () => import('./web').then((m) => new m.DeviceSecurityWeb()),
                  });

                  export * from './definitions';
                  export { DeviceSecurity };
                `,
              },
              {
                label: 'web.ts',
                lang: 'ts',
                code: code`
                  import { WebPlugin } from '@capacitor/core';
                  import type { DeviceSecurityPlugin } from './definitions';

                  export class DeviceSecurityWeb extends WebPlugin implements DeviceSecurityPlugin {
                    async echo(options: { value: string }): Promise<{ value: string }> {
                      return options;
                    }

                    async isDeviceSecure(): Promise<{ secure: boolean }> {
                      throw this.unimplemented('Not available on web.');
                    }
                  }
                `,
              },
              {
                label: 'Uso en la app',
                lang: 'ts',
                code: code`
                  import { DeviceSecurity } from 'capacitor-device-security';

                  const { secure } = await DeviceSecurity.isDeviceSecure();
                  const handle = await DeviceSecurity.addListener('statusChange', (e) => console.log(e.secure));
                  // later: await handle.remove();
                `,
              },
            ],
          },
        ],
        pitfalls: [
          "Devolver tipos no serializables (Date, Map, clases): el bridge solo transporta JSON.",
          "Métodos síncronos en la interfaz: todo cruce del bridge es async (Promise).",
        ],
        links: [['Plugin web implementation', 'https://capacitorjs.com/docs/plugins/web']],
      },
      {
        id: 'plugin-android',
        title: 'Implementación Android (Kotlin / Java)',
        tags: ['@CapacitorPlugin', '@PluginMethod', 'PluginCall', 'JSObject', 'resolve', 'reject', 'notifyListeners', 'permissions'],
        summary: "Una clase que extiende `Plugin`, anotada con `@CapacitorPlugin(name = ...)`. Cada método expuesto lleva `@PluginMethod` y recibe un `PluginCall` que se resuelve o rechaza.",
        when: ["Para exponer APIs de Android (KeyguardManager, NFC, SDKs nativos) a TypeScript."],
        blocks: [
          {
            t: 'tabs',
            tabs: [
              {
                label: 'Kotlin',
                lang: 'kotlin',
                file: 'DeviceSecurityPlugin.kt',
                code: code`
                  package com.company.plugins.devicesecurity

                  import android.app.KeyguardManager
                  import android.content.Context
                  import com.getcapacitor.JSObject
                  import com.getcapacitor.Plugin
                  import com.getcapacitor.PluginCall
                  import com.getcapacitor.PluginMethod
                  import com.getcapacitor.annotation.CapacitorPlugin

                  @CapacitorPlugin(name = "DeviceSecurity")
                  class DeviceSecurityPlugin : Plugin() {

                      @PluginMethod
                      fun echo(call: PluginCall) {
                          val value = call.getString("value")
                          if (value == null) {
                              call.reject("Missing 'value'")
                              return
                          }
                          val ret = JSObject()
                          ret.put("value", value)
                          call.resolve(ret)
                      }

                      @PluginMethod
                      fun isDeviceSecure(call: PluginCall) {
                          val km = context.getSystemService(Context.KEYGUARD_SERVICE) as KeyguardManager
                          val ret = JSObject()
                          ret.put("secure", km.isDeviceSecure)
                          call.resolve(ret)
                      }

                      // Emit an event to JS listeners
                      fun emitStatus(secure: Boolean) {
                          val data = JSObject()
                          data.put("secure", secure)
                          notifyListeners("statusChange", data)
                      }
                  }
                `,
              },
              {
                label: 'Java',
                lang: 'java',
                file: 'DeviceSecurityPlugin.java',
                code: code`
                  package com.company.plugins.devicesecurity;

                  import android.app.KeyguardManager;
                  import android.content.Context;
                  import com.getcapacitor.JSObject;
                  import com.getcapacitor.Plugin;
                  import com.getcapacitor.PluginCall;
                  import com.getcapacitor.PluginMethod;
                  import com.getcapacitor.annotation.CapacitorPlugin;

                  @CapacitorPlugin(name = "DeviceSecurity")
                  public class DeviceSecurityPlugin extends Plugin {

                      @PluginMethod
                      public void echo(PluginCall call) {
                          String value = call.getString("value");
                          if (value == null) {
                              call.reject("Missing 'value'");
                              return;
                          }
                          JSObject ret = new JSObject();
                          ret.put("value", value);
                          call.resolve(ret);
                      }

                      @PluginMethod
                      public void isDeviceSecure(PluginCall call) {
                          KeyguardManager km = (KeyguardManager) getContext().getSystemService(Context.KEYGUARD_SERVICE);
                          JSObject ret = new JSObject();
                          ret.put("secure", km.isDeviceSecure());
                          call.resolve(ret);
                      }
                  }
                `,
              },
              {
                label: 'Permisos',
                lang: 'kotlin',
                code: code`
                  @CapacitorPlugin(
                      name = "Scanner",
                      permissions = [Permission(strings = [Manifest.permission.CAMERA], alias = "camera")]
                  )
                  class ScannerPlugin : Plugin() {

                      @PluginMethod
                      fun scan(call: PluginCall) {
                          if (getPermissionState("camera") != PermissionState.GRANTED) {
                              requestPermissionForAlias("camera", call, "cameraPermsCallback")
                              return
                          }
                          doScan(call)
                      }

                      @PermissionCallback
                      private fun cameraPermsCallback(call: PluginCall) {
                          if (getPermissionState("camera") == PermissionState.GRANTED) doScan(call)
                          else call.reject("Camera permission is required")
                      }

                      private fun doScan(call: PluginCall) { /* ... */ call.resolve() }
                  }
                `,
              },
            ],
          },
        ],
        pitfalls: [
          "No llamar `resolve()` ni `reject()` en algún camino: la Promise en JS nunca termina.",
          "Trabajo pesado en el hilo principal: bloquea la UI. Usa un executor/coroutine y resuelve después.",
          "Actividades con resultado: usa `startActivityForResult(call, intent, \"callbackName\")` + `@ActivityCallback`, no la API vieja de Android.",
        ],
        links: [['Android plugin guide', 'https://capacitorjs.com/docs/plugins/android']],
      },
      {
        id: 'plugin-ios',
        title: 'Implementación iOS (Swift)',
        tags: ['CAPPlugin', 'CAPBridgedPlugin', 'CAPPluginMethod', 'CAPPluginCall', 'jsName', 'Swift'],
        summary: "Desde Capacitor 6 los plugins Swift implementan `CAPBridgedPlugin` declarando `identifier`, `jsName` y `pluginMethods` (sustituye al archivo `.m` con macros de versiones anteriores).",
        when: ["Para exponer APIs de iOS (LocalAuthentication, CoreNFC, SDKs nativos)."],
        blocks: [
          {
            t: 'code',
            lang: 'swift',
            file: 'DeviceSecurityPlugin.swift',
            code: code`
              import Foundation
              import Capacitor
              import LocalAuthentication

              @objc(DeviceSecurityPlugin)
              public class DeviceSecurityPlugin: CAPPlugin, CAPBridgedPlugin {
                  public let identifier = "DeviceSecurityPlugin"
                  public let jsName = "DeviceSecurity"
                  public let pluginMethods: [CAPPluginMethod] = [
                      CAPPluginMethod(name: "echo", returnType: CAPPluginReturnPromise),
                      CAPPluginMethod(name: "isDeviceSecure", returnType: CAPPluginReturnPromise)
                  ]

                  @objc func echo(_ call: CAPPluginCall) {
                      guard let value = call.getString("value") else {
                          call.reject("Missing 'value'")
                          return
                      }
                      call.resolve(["value": value])
                  }

                  @objc func isDeviceSecure(_ call: CAPPluginCall) {
                      let secure = LAContext().canEvaluatePolicy(.deviceOwnerAuthentication, error: nil)
                      call.resolve(["secure": secure])
                  }

                  func emitStatus(_ secure: Bool) {
                      notifyListeners("statusChange", data: ["secure": secure])
                  }
              }
            `,
          },
          {
            t: 'note',
            kind: 'info',
            text: "Si tocas UI (presentar un view controller), hazlo en el hilo principal: `DispatchQueue.main.async { … }` y usa `bridge?.viewController` para presentar.",
          },
        ],
        pitfalls: [
          "Olvidar añadir el método a `pluginMethods`: JS recibe \"not implemented\".",
          "`jsName` distinto del nombre usado en `registerPlugin`.",
          "Falta la clave `NS…UsageDescription` que requiere la API usada: crash al invocarla.",
        ],
        links: [['iOS plugin guide', 'https://capacitorjs.com/docs/plugins/ios']],
      },
      {
        id: 'plugin-local',
        title: 'Código nativo local (sin paquete npm)',
        tags: ['registerPlugin', 'MainActivity', 'CAPBridgeViewController', 'capacitorDidLoad', 'registerPluginInstance'],
        summary: "Para código nativo exclusivo de una app, crea la clase del plugin dentro de `android/` e `ios/` y regístrala manualmente. En TS usas `registerPlugin` con el mismo nombre.",
        when: ["Integraciones puntuales que no vas a reutilizar en otras apps."],
        blocks: [
          {
            t: 'tabs',
            tabs: [
              {
                label: 'Android',
                lang: 'java',
                file: 'android/app/src/main/java/com/company/myapp/MainActivity.java',
                code: code`
                  package com.company.myapp;

                  import android.os.Bundle;
                  import com.getcapacitor.BridgeActivity;

                  public class MainActivity extends BridgeActivity {
                      @Override
                      public void onCreate(Bundle savedInstanceState) {
                          registerPlugin(DeviceSecurityPlugin.class); // BEFORE super.onCreate
                          super.onCreate(savedInstanceState);
                      }
                  }
                `,
              },
              {
                label: 'iOS',
                lang: 'swift',
                file: 'ios/App/App/MyViewController.swift',
                code: code`
                  import UIKit
                  import Capacitor

                  class MyViewController: CAPBridgeViewController {
                      override open func capacitorDidLoad() {
                          bridge?.registerPluginInstance(DeviceSecurityPlugin())
                      }
                  }

                  // Main.storyboard → Bridge View Controller → Custom Class: MyViewController
                `,
              },
              {
                label: 'TypeScript',
                lang: 'ts',
                file: 'src/app/native/device-security.ts',
                code: code`
                  import { registerPlugin } from '@capacitor/core';

                  export interface DeviceSecurityPlugin {
                    isDeviceSecure(): Promise<{ secure: boolean }>;
                  }

                  export const DeviceSecurity = registerPlugin<DeviceSecurityPlugin>('DeviceSecurity');
                `,
              },
            ],
          },
        ],
        pitfalls: [
          "Registrar el plugin después de `super.onCreate`: no queda disponible.",
          "No cambiar la Custom Class en el storyboard: `capacitorDidLoad` nunca se ejecuta.",
          "Llamarlo en web sin implementación: lanza \"not implemented\"; protege con `Capacitor.isNativePlatform()`.",
        ],
        links: [
          ['Custom Native Code (Android)', 'https://capacitorjs.com/docs/android/custom-code'],
          ['Custom Native Code (iOS)', 'https://capacitorjs.com/docs/ios/custom-code'],
        ],
      },
    ],
  },

  /* ===================================================================
     13. MIGRACIÓN CORDOVA → CAPACITOR
     =================================================================== */
  {
    id: 'migracion',
    num: 13,
    title: 'Migración Cordova → Capacitor',
    desc: "Pasos, equivalencias de plugins, `@awesome-cordova-plugins`, traducir `config.xml`, conservar datos del usuario y problemas típicos.",
    topics: [
      {
        id: 'pasos',
        title: 'Pasos de la migración',
        tags: ['migración', 'cordova', 'cap init', 'ionic integrations', 'config.xml'],
        summary: "Capacitor puede convivir con la mayoría de plugins Cordova, así que la migración es incremental: añade Capacitor, genera los proyectos nativos, y reemplaza plugins Cordova por equivalentes de Capacitor uno a uno.",
        when: ["Apps Ionic/Cordova existentes que necesitan SDKs nativos modernos o mantenimiento a largo plazo."],
        blocks: [
          {
            t: 'code',
            lang: 'bash',
            code: code`
              # 0. New branch + note config.xml values (widget id, version, preferences, plugin variables)
              git checkout -b feat/capacitor

              # 1. Add Capacitor (use the SAME app id as config.xml <widget id="...">)
              ionic integrations enable capacitor     # Ionic CLI projects
              # or: npm install @capacitor/core && npm install -D @capacitor/cli
              npx cap init "My App" com.company.myapp --web-dir=www

              # 2. Build web assets
              ionic build

              # 3. Native platforms
              npm install @capacitor/android @capacitor/ios
              npx cap add android
              npx cap add ios

              # 4. Icons & splash from a single source
              npm install -D @capacitor/assets
              npx capacitor-assets generate

              # 5. Replace Cordova plugins one by one (see equivalences)
              npm uninstall cordova-plugin-splashscreen
              npm install @capacitor/splash-screen
              npx cap sync

              # 6. When nothing depends on Cordova anymore
              # remove cordova platforms/plugins folders and config.xml (keep a copy for reference)
            `,
          },
          {
            t: 'list',
            title: 'Checklist',
            ordered: true,
            items: [
              "Mismo `appId`, mismo keystore Android y mismo Bundle ID iOS que la app publicada (si no, las tiendas la tratan como app nueva).",
              "Subir `versionCode`/Build por encima del último publicado con Cordova.",
              "Traducir `config.xml` (preferencias, permisos, orientación) a `capacitor.config.ts`, `AndroidManifest.xml` e `Info.plist`.",
              "Decidir el origen del WebView para **no perder datos locales** (ver [Conservar datos](#/migracion/conservar-datos)).",
              "Probar deep links, push y cualquier plugin con variables de instalación.",
            ],
          },
        ],
        pitfalls: [
          "Firmar con un keystore nuevo: Google Play rechaza la actualización.",
          "Borrar Cordova antes de tener equivalentes funcionando para todos los plugins.",
          "Olvidar plugins Cordova \"invisibles\" (whitelist, ionic-webview, keyboard): algunos son incompatibles y deben eliminarse.",
        ],
        links: [
          ['Migrating from Cordova', 'https://capacitorjs.com/docs/cordova/migrating-from-cordova-to-capacitor'],
          ['Cordova compatibility', 'https://capacitorjs.com/docs/cordova'],
        ],
      },
      {
        id: 'equivalencias',
        title: 'Equivalencias de plugins Cordova → Capacitor',
        tags: ['equivalencias', 'cordova-plugin', '@capacitor', 'reemplazo'],
        summary: "Tabla de reemplazos habituales. Los plugins listados como incompatibles en la documentación de Capacitor deben eliminarse sí o sí.",
        when: ["Al planificar la migración y estimar esfuerzo."],
        blocks: [
          {
            t: 'table',
            head: ['Cordova', 'Capacitor / alternativa'],
            rows: [
              ['`cordova-plugin-camera`', '`@capacitor/camera`'],
              ['`cordova-plugin-file`', '`@capacitor/filesystem` (+ `@capacitor/file-transfer` para descargas)'],
              ['`cordova-plugin-file-transfer`', '`@capacitor/file-transfer` ⚠ verificar'],
              ['`cordova-plugin-geolocation`', '`@capacitor/geolocation`'],
              ['`cordova-plugin-network-information`', '`@capacitor/network`'],
              ['`cordova-plugin-splashscreen`', '`@capacitor/splash-screen` (incompatible: eliminar)'],
              ['`cordova-plugin-statusbar`', '`@capacitor/status-bar`'],
              ['`cordova-plugin-ionic-keyboard`', '`@capacitor/keyboard` (incompatible: eliminar)'],
              ['`cordova-plugin-ionic-webview` / `wkwebview-engine` / `whitelist`', 'No necesarios (eliminar).'],
              ['`cordova-plugin-device`', '`@capacitor/device`'],
              ['`cordova-plugin-dialogs`', '`@capacitor/dialog` o `AlertController`'],
              ['`cordova-plugin-inappbrowser`', '`@capacitor/browser` o `@capacitor/inappbrowser` ⚠ verificar'],
              ['`cordova-plugin-local-notification`', '`@capacitor/local-notifications`'],
              ['`phonegap-plugin-push` / `cordova-plugin-firebasex`', '`@capacitor/push-notifications` (+ `@capacitor-firebase/messaging`)'],
              ['`cordova-plugin-x-socialsharing`', '`@capacitor/share`'],
              ['`cordova-plugin-vibration`', '`@capacitor/haptics`'],
              ['`cordova-plugin-nativestorage`', '`@capacitor/preferences` (`configure({ group: \'NativeStorage\' })`)'],
              ['`cordova-plugin-app-version`', '`App.getInfo()` de `@capacitor/app`'],
              ['`cordova-clipboard`', '`@capacitor/clipboard`'],
              ['`cordova-plugin-screen-orientation`', '`@capacitor/screen-orientation`'],
              ['`cordova-sqlite-storage`', '`@capacitor-community/sqlite`'],
              ['`cordova-plugin-advanced-http`', '`CapacitorHttp` (core)'],
              ['`cordova-plugin-fingerprint-aio`', 'Plugin biométrico comunitario (ver [Biometría](#/seguridad/biometria))'],
            ],
          },
        ],
        pitfalls: [
          "Mantener dos plugins para lo mismo (Cordova + Capacitor): conflictos de permisos y comportamiento duplicado.",
          "Suponer que la API es idéntica: revisa tipos de retorno (callbacks → Promises, rutas `file://` → `webPath`).",
        ],
        links: [
          ['Plugins oficiales', 'https://capacitorjs.com/docs/apis'],
          ['Cordova plugins conocidos incompatibles', 'https://capacitorjs.com/docs/plugins/cordova#known-incompatible-plugins'],
        ],
      },
      {
        id: 'awesome-cordova',
        title: 'Usar plugins Cordova con `@awesome-cordova-plugins`',
        tags: ['@awesome-cordova-plugins', '@ionic-native', 'ngx', 'providers', 'cordova en capacitor'],
        summary: "`@awesome-cordova-plugins` (sucesor de `@ionic-native`) ofrece wrappers tipados con Promises/Observables para plugins Cordova. Siguen funcionando en Capacitor.",
        when: ["Plugins sin equivalente Capacitor (SDKs de terceros, plugins internos antiguos)."],
        blocks: [
          {
            t: 'code',
            lang: 'bash',
            code: code`
              npm install cordova-plugin-example @awesome-cordova-plugins/core @awesome-cordova-plugins/example
              npx cap sync
            `,
          },
          {
            t: 'tabs',
            tabs: [
              {
                label: 'Standalone',
                lang: 'ts',
                code: code`
                  // main.ts — wrappers are not providedIn: 'root', register them
                  import { Example } from '@awesome-cordova-plugins/example/ngx';

                  bootstrapApplication(AppComponent, {
                    providers: [provideIonicAngular(), Example /* , ... */],
                  });

                  // usage
                  export class SomePage {
                    private readonly example = inject(Example);
                    private readonly platform = inject(Platform);

                    async run(): Promise<void> {
                      await this.platform.ready(); // Cordova plugins need deviceready
                      const result = await this.example.doSomething();
                    }
                  }
                `,
              },
              {
                label: 'Legacy',
                lang: 'ts',
                code: code`
                  // app.module.ts (legacy)
                  import { Example } from '@awesome-cordova-plugins/example/ngx';

                  @NgModule({
                    providers: [Example],
                  })
                  export class AppModule {}
                `,
              },
            ],
          },
          {
            t: 'code',
            lang: 'ts',
            title: 'Variables y preferencias de plugins Cordova en Capacitor',
            file: 'capacitor.config.ts',
            code: code`
              cordova: {
                preferences: {
                  // previously <preference name="..." value="..."/> in config.xml
                  ScrollEnabled: 'false',
                  BackupWebStorage: 'none',
                },
              },
              // Install-time variables (--variable API_KEY=...) usually go to
              // AndroidManifest.xml meta-data / strings.xml and Info.plist manually ⚠ verify per plugin
            `,
          },
        ],
        pitfalls: [
          "No añadir el wrapper a `providers`: `NullInjectorError: No provider for Example`.",
          "Llamar al plugin antes de `platform.ready()`: `cordova_not_available` o `undefined`.",
          "Plugins Cordova con hooks de instalación: Capacitor no ejecuta hooks; replica sus cambios a mano.",
        ],
        links: [
          ['Awesome Cordova Plugins', 'https://danielsogl.gitbook.io/awesome-cordova-plugins'],
          ['Using Cordova plugins', 'https://capacitorjs.com/docs/plugins/cordova'],
        ],
      },
      {
        id: 'conservar-datos',
        title: 'Conservar `localStorage`/IndexedDB del usuario',
        tags: ['origen', 'hostname', 'androidScheme', 'iosScheme', 'ionic://localhost', 'datos', 'migración'],
        summary: "El almacenamiento web está ligado al **origen**. Cordova con `cordova-plugin-ionic-webview` usaba `http://localhost` (Android) e `ionic://localhost` (iOS). Si Capacitor usa otro origen, los usuarios pierden sesión y datos locales al actualizar.",
        when: ["Siempre que la app Cordova guardaba algo en `localStorage`, IndexedDB, WebSQL o cookies."],
        blocks: [
          {
            t: 'code',
            lang: 'ts',
            file: 'capacitor.config.ts',
            code: code`
              server: {
                // Match the old cordova-plugin-ionic-webview origins
                hostname: 'localhost',
                androidScheme: 'http',  // old: http://localhost   (Capacitor default is https)
                iosScheme: 'ionic',     // old: ionic://localhost  (Capacitor default is capacitor)
              },
            `,
          },
          {
            t: 'note',
            kind: 'warn',
            text: "Con `androidScheme: 'http'` el origen no es seguro: algunas APIs web (crypto.subtle, geolocalización web, service workers) requieren contexto seguro. Alternativa: mantener el esquema viejo una versión, migrar los datos a `Preferences`/SQLite, y cambiar a `https` en la siguiente (aceptando el cambio de origen).",
          },
        ],
        pitfalls: [
          "Descubrir el problema en producción: los usuarios aparecen deslogueados tras actualizar.",
          "Cambiar el esquema más adelante sin plan de migración: vuelve a perderse todo.",
          "Probar solo con instalación limpia: prueba **actualizando** sobre la versión Cordova instalada.",
        ],
        links: [
          ['Config: server', 'https://capacitorjs.com/docs/config'],
          ['Migración de datos', 'https://capacitorjs.com/docs/cordova/migrating-from-cordova-to-capacitor'],
        ],
      },
      {
        id: 'problemas-tipicos',
        title: 'Problemas típicos en la migración',
        tags: ['deviceready', 'hooks', 'plugin.xml', 'file://', 'cordova.js', 'incompatibles'],
        summary: "Lo que suele romperse al pasar de Cordova a Capacitor y cómo resolverlo.",
        when: ["Durante las pruebas de la rama de migración."],
        blocks: [
          {
            t: 'table',
            head: ['Síntoma', 'Causa', 'Solución'],
            rows: [
              ['Pantalla en blanco', 'Plugin incompatible (ionic-webview, splashscreen…) o `webDir` incorrecto', 'Elimina incompatibles; revisa `webDir` y consola en `chrome://inspect`.'],
              ['`cordova is not defined`', 'Código que accede a `window.cordova` antes de tiempo', 'Espera `platform.ready()` o migra a plugin Capacitor.'],
              ['Permisos faltantes', '`config.xml`/hooks añadían entradas al manifest/plist', 'Añádelas a mano en `AndroidManifest.xml`/`Info.plist`.'],
              ['Imágenes con `file://` no cargan', 'El WebView no permite `file://` desde el origen http(s)', 'Usa `Capacitor.convertFileSrc(uri)` o `webPath`.'],
              ['Sesión perdida tras actualizar', 'Cambio de origen', 'Ver [Conservar datos](#/migracion/conservar-datos).'],
              ['Build Android falla por Gradle', 'Plugins Cordova antiguos con dependencias obsoletas (jcenter, support libs)', 'Actualiza el plugin, usa Jetifier o reemplázalo.'],
              ['Push duplicadas', 'Plugin Cordova de push + `@capacitor/push-notifications`', 'Deja solo uno.'],
            ],
          },
        ],
        pitfalls: [
          "Tratar de \"arreglar\" errores editando archivos generados (`capacitor.plugins.json`, `assets/public`): se sobrescriben en `sync`.",
          "No leer la salida de `npx cap sync`: avisa de plugins Cordova incompatibles o que requieren configuración.",
        ],
        links: [['Troubleshooting Cordova plugins', 'https://capacitorjs.com/docs/plugins/cordova']],
      },
    ],
  },

  /* ===================================================================
     14. RENDIMIENTO
     =================================================================== */
  {
    id: 'rendimiento',
    num: 14,
    title: 'Rendimiento',
    desc: "Lazy loading y bundle, imágenes, listas grandes, animaciones y medición en dispositivo real.",
    topics: [
      {
        id: 'lazy-loading',
        title: 'Lazy loading, `@defer` y tamaño del bundle',
        tags: ['loadComponent', 'PreloadAllModules', '@defer', 'budgets', 'stats-json', 'tree-shaking'],
        summary: "Carga cada página bajo demanda con `loadComponent`, difiere bloques pesados con `@defer` y vigila el bundle con budgets y el análisis de esbuild. En standalone, importar solo los componentes Ionic usados ya reduce mucho el tamaño.",
        when: ["Arranque lento, bundle inicial grande, pantallas con librerías pesadas (gráficas, mapas, PDF)."],
        blocks: [
          {
            t: 'code',
            lang: 'html',
            code: code`
              <!-- Heavy chart only when it enters the viewport -->
              @defer (on viewport) {
                <app-spending-chart [data]="data()"></app-spending-chart>
              } @placeholder {
                <ion-skeleton-text [animated]="true" class="chart-skeleton"></ion-skeleton-text>
              } @loading (minimum 300ms) {
                <ion-spinner name="crescent"></ion-spinner>
              }
            `,
          },
          {
            t: 'code',
            lang: 'bash',
            title: 'Analizar el bundle',
            code: code`
              npx ng build --configuration production --stats-json
              # Upload dist/<app>/stats.json to https://esbuild.github.io/analyze/
            `,
          },
          {
            t: 'code',
            lang: 'json',
            title: 'Budgets en angular.json',
            code: code`
              "budgets": [
                { "type": "initial", "maximumWarning": "1mb", "maximumError": "1.5mb" },
                { "type": "anyComponentStyle", "maximumWarning": "4kb", "maximumError": "8kb" }
              ]
            `,
          },
          {
            t: 'list',
            items: [
              "`withPreloading(PreloadAllModules)` precarga rutas tras el arranque: buena UX en apps medianas; en apps muy grandes considera una estrategia selectiva.",
              "Registra en `addIcons` solo los iconos usados.",
              "Importa funciones concretas de librerías (`date-fns/format`) en lugar de paquetes completos.",
            ],
          },
        ],
        pitfalls: [
          "Importar una página en `app.routes.ts` con `component:` en vez de `loadComponent`: entra al bundle inicial.",
          "Librerías CommonJS grandes (moment, lodash completo): sin tree-shaking.",
          "`IonicModule` en un proyecto standalone: arrastra todos los componentes.",
        ],
        links: [
          ['Deferrable views', 'https://angular.dev/guide/templates/defer'],
          ['Ionic Angular performance', 'https://ionicframework.com/docs/angular/performance'],
        ],
      },
      {
        id: 'imagenes',
        title: 'Imágenes',
        tags: ['ion-img', 'NgOptimizedImage', 'ngSrc', 'WebP', 'AVIF', 'lazy'],
        summary: "Usa `ion-img` (carga perezosa dentro de `ion-content`) o `NgOptimizedImage` (`ngSrc` con tamaños). Sirve formatos modernos y tamaños adecuados al dispositivo.",
        when: ["Listas con avatares/logos, galerías, banners."],
        blocks: [
          {
            t: 'code',
            lang: 'html',
            code: code`
              <!-- Lazy loaded when visible inside ion-content -->
              <ion-thumbnail slot="start">
                <ion-img [src]="m.logoUrl" alt="" (ionError)="m.logoUrl = fallback"></ion-img>
              </ion-thumbnail>

              <!-- Angular optimized image (needs width/height or fill) -->
              <img ngSrc="assets/img/banner.webp" width="800" height="300" priority alt="Promoción" />
            `,
          },
          {
            t: 'list',
            items: [
              "Redimensiona en servidor/CDN; no descargues imágenes de 3000 px para mostrarlas a 64 px.",
              "Fotos de la cámara: `width`/`quality` en `getPhoto` y sube el archivo, no base64.",
              "Cachea imágenes remotas críticas en `Filesystem` si deben verse offline.",
            ],
          },
        ],
        pitfalls: [
          "`<img>` sin dimensiones: saltos de layout (CLS).",
          "Base64 gigantes en el estado de Angular o en `Preferences`.",
        ],
        links: [
          ['ion-img', 'https://ionicframework.com/docs/api/img'],
          ['NgOptimizedImage', 'https://angular.dev/guide/image-optimization'],
        ],
      },
      {
        id: 'listas-grandes',
        title: 'Listas grandes y change detection',
        tags: ['@for track', 'OnPush', 'signals', 'virtual scroll', 'paginación', 'zoneless'],
        summary: "Renderiza solo lo necesario (paginación, infinite scroll, virtual scroll), identifica items con `track` y reduce trabajo de change detection con signals y `OnPush`.",
        when: ["Listas de cientos/miles de elementos, scroll con tirones en Android de gama baja."],
        blocks: [
          {
            t: 'code',
            lang: 'ts',
            code: code`
              @Component({
                selector: 'app-movement-row',
                changeDetection: ChangeDetectionStrategy.OnPush,
                template: \`
                  <ion-item>
                    <ion-label>
                      <h3>{{ movement().description }}</h3>
                      <p>{{ formattedDate() }}</p>
                    </ion-label>
                  </ion-item>
                \`,
                imports: [IonItem, IonLabel],
              })
              export class MovementRowComponent {
                readonly movement = input.required<Movement>();
                // computed instead of calling a function from the template on every CD
                readonly formattedDate = computed(() => new Date(this.movement().date).toLocaleDateString());
              }

              // parent template:
              // @for (m of movements(); track m.id) { <app-movement-row [movement]="m" /> }
            `,
          },
          {
            t: 'table',
            head: ['Técnica', 'Cuándo'],
            rows: [
              ['[Infinite scroll](#/componentes/infinite-scroll)', 'Datos paginados del servidor.'],
              ['[Virtual scroll](#/componentes/virtual-scroll)', 'Miles de items ya en memoria y altura fija.'],
              ['`track item.id`', 'Siempre en `@for` (evita recrear DOM al refrescar).'],
              ['Signals + `OnPush`', 'Componentes de fila y páginas con mucho estado.'],
              ['Zoneless', 'Menos CD global; comprueba compatibilidad de Ionic con tu versión ⚠ verificar.'],
            ],
          },
        ],
        pitfalls: [
          "`track $index` en listas que se reordenan o filtran: Angular reutiliza mal los nodos.",
          "Funciones costosas en el template (`{{ format(x) }}`) dentro de listas grandes.",
          "Sombras y filtros CSS pesados en cada fila: penalizan el scroll en Android.",
        ],
        links: [
          ['Control flow @for', 'https://angular.dev/guide/templates/control-flow'],
          ['Signals', 'https://angular.dev/guide/signals'],
        ],
      },
      {
        id: 'animaciones',
        title: 'Animaciones (`AnimationController`)',
        tags: ['AnimationController', 'createAnimation', 'Web Animations', 'transform', 'opacity', 'prefers-reduced-motion'],
        summary: "Ionic incluye un motor de animaciones basado en Web Animations API. Anima solo `transform` y `opacity` para mantener 60 fps.",
        when: ["Microinteracciones (shake de error, aparición de cards), transiciones personalizadas."],
        blocks: [
          {
            t: 'code',
            lang: 'ts',
            code: code`
              import { ElementRef, inject, viewChild } from '@angular/core';
              import { AnimationController } from '@ionic/angular/standalone';

              private readonly animCtrl = inject(AnimationController);
              readonly cvvField = viewChild.required<ElementRef<HTMLElement>>('cvvField');

              shakeInvalid(): Promise<void> {
                return this.animCtrl
                  .create()
                  .addElement(this.cvvField().nativeElement)
                  .duration(400)
                  .easing('ease-in-out')
                  .keyframes([
                    { offset: 0, transform: 'translateX(0)' },
                    { offset: 0.25, transform: 'translateX(-8px)' },
                    { offset: 0.5, transform: 'translateX(8px)' },
                    { offset: 0.75, transform: 'translateX(-4px)' },
                    { offset: 1, transform: 'translateX(0)' },
                  ])
                  .play();
              }
            `,
          },
          {
            t: 'code',
            lang: 'scss',
            code: code`
              // Respect the user's accessibility setting
              @media (prefers-reduced-motion: reduce) {
                * { animation-duration: 0.01ms !important; transition-duration: 0.01ms !important; }
              }
            `,
          },
        ],
        pitfalls: [
          "Animar `height`, `top`, `left`, `box-shadow`: provoca layout/paint en cada frame.",
          "Muchas animaciones simultáneas durante la transición de página: compiten con la animación de Ionic.",
          "Desactivar todas las animaciones (`animated: false`) para \"ganar rendimiento\": oculta el problema real.",
        ],
        links: [['Animations', 'https://ionicframework.com/docs/utilities/animations']],
      },
      {
        id: 'medicion',
        title: 'Medir en dispositivo real',
        tags: ['chrome://inspect', 'Safari Web Inspector', 'Performance', 'Profiler', 'Instruments', 'release build'],
        summary: "El rendimiento se mide en un dispositivo real (idealmente Android de gama media/baja) con build de release, usando las DevTools remotas del WebView y los profilers nativos.",
        when: ["Antes de optimizar (para saber qué optimizar) y antes de cada release importante."],
        blocks: [
          {
            t: 'table',
            head: ['Herramienta', 'Para qué'],
            rows: [
              ['`chrome://inspect` → Performance', 'CPU, long tasks, layout/paint en Android WebView.'],
              ['Safari → Desarrollo → dispositivo → Timelines', 'Lo mismo en iOS (WKWebView).'],
              ['Lighthouse (modo móvil)', 'Métricas web generales sobre `ionic serve --prod` o la PWA.'],
              ['Android Studio Profiler', 'Memoria, CPU nativa, arranque.'],
              ['Xcode Instruments', 'Time Profiler, Allocations, Energy.'],
              ['`performance.mark/measure`', 'Medir tus propios hitos (arranque → primera página útil).'],
            ],
          },
          {
            t: 'code',
            lang: 'ts',
            code: code`
              // main.ts
              performance.mark('app-start');

              // first page
              ionViewDidEnter(): void {
                performance.mark('home-ready');
                const m = performance.measure('startup', 'app-start', 'home-ready');
                console.info('Startup ms', Math.round(m.duration));
              }
            `,
          },
        ],
        pitfalls: [
          "Medir en el emulador o en un iPhone de gama alta y concluir que \"va bien\".",
          "Medir builds de debug (sin optimización ni minificación).",
          "Dejar `console.log` masivos en producción: también cuestan rendimiento.",
        ],
        links: [
          ['Debugging (Capacitor)', 'https://capacitorjs.com/docs/vscode/debugging'],
          ['Chrome DevTools Performance', 'https://developer.chrome.com/docs/devtools/performance'],
        ],
      },
    ],
  },

  /* ===================================================================
     15. BUILD Y DESPLIEGUE
     =================================================================== */
  {
    id: 'build-despliegue',
    num: 15,
    title: 'Build y despliegue',
    desc: "Environments, build Android (Gradle, keystore, AAB, `versionCode`), iOS (Xcode, signing), íconos y splash con `@capacitor/assets`, Live Updates y PWA.",
    topics: [
      {
        id: 'environments',
        title: 'Environments (dev, staging, prod)',
        tags: ['environment.ts', 'fileReplacements', 'configuration', 'apiUrl', '10.0.2.2'],
        summary: "Angular sustituye `environment.ts` en tiempo de build según la configuración (`fileReplacements`). Combínalo con `capacitor.config.ts` si necesitas `appId` o nombre distintos por entorno.",
        when: ["Apuntar a APIs distintas por entorno; activar logs o features solo en desarrollo."],
        blocks: [
          {
            t: 'tabs',
            tabs: [
              {
                label: 'environment.ts',
                lang: 'ts',
                file: 'src/environments/environment.ts',
                code: code`
                  // Development (Android emulator reaches the host machine through 10.0.2.2)
                  export const environment = {
                    production: false,
                    apiUrl: 'http://10.0.2.2:5000/api',
                    appVersion: '1.2.3-dev',
                  };
                `,
              },
              {
                label: 'environment.prod.ts',
                lang: 'ts',
                file: 'src/environments/environment.prod.ts',
                code: code`
                  export const environment = {
                    production: true,
                    apiUrl: 'https://api.example.com/api',
                    appVersion: '1.2.3',
                  };
                `,
              },
              {
                label: 'angular.json',
                lang: 'json',
                code: code`
                  "configurations": {
                    "production": {
                      "fileReplacements": [
                        { "replace": "src/environments/environment.ts", "with": "src/environments/environment.prod.ts" }
                      ],
                      "outputHashing": "all"
                    },
                    "staging": {
                      "fileReplacements": [
                        { "replace": "src/environments/environment.ts", "with": "src/environments/environment.staging.ts" }
                      ]
                    }
                  }
                `,
              },
              {
                label: 'Build',
                lang: 'bash',
                code: code`
                  npx ng build --configuration production
                  npx ng build --configuration staging
                  npx cap sync
                `,
              },
            ],
          },
        ],
        pitfalls: [
          "Secretos en `environment.*.ts`: viajan dentro de la app.",
          "Olvidar `--configuration production` antes de `cap sync` para release: sale la API de desarrollo.",
          "`10.0.2.2` en un dispositivo físico: solo funciona en el emulador Android.",
        ],
        links: [['Angular build environments', 'https://angular.dev/tools/cli/environments']],
      },
      {
        id: 'android-build',
        title: 'Build Android: versionCode, keystore y AAB',
        tags: ['Gradle', 'keystore', 'AAB', 'bundleRelease', 'versionCode', 'versionName', 'signingConfigs', 'Play App Signing'],
        summary: "La versión se define en `android/app/build.gradle`. Para publicar se genera un **AAB firmado** con tu keystore de subida; Google Play re-firma con su clave (Play App Signing).",
        when: ["Cada release a Google Play (interno, cerrado, producción)."],
        blocks: [
          {
            t: 'code',
            lang: 'bash',
            title: '1) Crear el keystore (una vez; guárdalo fuera del repo y con backup)',
            code: code`
              keytool -genkeypair -v -keystore release.jks -alias upload -keyalg RSA -keysize 2048 -validity 10000
            `,
          },
          {
            t: 'tabs',
            title: '2) Versionado y firma',
            tabs: [
              {
                label: 'build.gradle',
                lang: 'gradle',
                file: 'android/app/build.gradle',
                code: code`
                  def keystorePropertiesFile = rootProject.file("keystore.properties")
                  def keystoreProperties = new Properties()
                  if (keystorePropertiesFile.exists()) {
                      keystoreProperties.load(new FileInputStream(keystorePropertiesFile))
                  }

                  android {
                      namespace "com.company.myapp"
                      defaultConfig {
                          applicationId "com.company.myapp"
                          versionCode 10203        // integer, must increase every upload (e.g. 1.2.3 → 10203)
                          versionName "1.2.3"      // visible to users
                      }
                      signingConfigs {
                          release {
                              if (keystoreProperties['storeFile']) {
                                  storeFile file(keystoreProperties['storeFile'])
                                  storePassword keystoreProperties['storePassword']
                                  keyAlias keystoreProperties['keyAlias']
                                  keyPassword keystoreProperties['keyPassword']
                              }
                          }
                      }
                      buildTypes {
                          release {
                              signingConfig signingConfigs.release
                              minifyEnabled true
                              proguardFiles getDefaultProguardFile('proguard-android-optimize.txt'), 'proguard-rules.pro'
                          }
                      }
                  }
                `,
              },
              {
                label: 'keystore.properties',
                lang: 'properties',
                file: 'android/keystore.properties (en .gitignore)',
                code: code`
                  storeFile=../keystores/release.jks
                  storePassword=CHANGE_ME
                  keyAlias=upload
                  keyPassword=CHANGE_ME
                `,
              },
            ],
          },
          {
            t: 'tabs',
            title: '3) Generar el AAB',
            tabs: [
              {
                label: 'Gradle',
                lang: 'bash',
                code: code`
                  npx ng build --configuration production
                  npx cap sync android
                  cd android
                  ./gradlew bundleRelease      # Windows: gradlew.bat bundleRelease
                  # → android/app/build/outputs/bundle/release/app-release.aab
                  ./gradlew assembleRelease    # APK (testing / other stores)
                `,
              },
              {
                label: 'Capacitor CLI',
                lang: 'bash',
                code: code`
                  npx cap build android \
                    --keystorepath ./android/keystores/release.jks \
                    --keystorepass "$KEYSTORE_PASS" \
                    --keystorealias upload \
                    --keystorealiaspass "$KEY_PASS" \
                    --androidreleasetype AAB
                `,
              },
              {
                label: 'Android Studio',
                blocks: [
                  {
                    t: 'list',
                    ordered: true,
                    items: [
                      "`npx cap open android`",
                      "Build → Generate Signed App Bundle / APK…",
                      "Android App Bundle → keystore, alias y contraseñas → `release`.",
                    ],
                  },
                ],
              },
            ],
          },
          {
            t: 'note',
            kind: 'info',
            text: "Requisitos de toolchain: Capacitor 7+ requiere **JDK 21**; comprueba en la guía de actualización de Capacitor 8 la versión de Android Studio, `compileSdk`/`targetSdk` y `minSdk` (en `android/variables.gradle`) ⚠ verificar. Google Play exige un `targetSdk` mínimo que sube cada año.",
          },
        ],
        pitfalls: [
          "Perder el keystore de subida: con Play App Signing puedes pedir reset a Google, pero es un trámite; sin él, no podrías actualizar.",
          "Subir con el mismo `versionCode`: Play lo rechaza.",
          "Commitear `keystore.properties` o el `.jks` al repo.",
          "Activar `minifyEnabled` sin probar la release: plugins que usan reflexión pueden fallar.",
        ],
        links: [
          ['Deploying to Google Play', 'https://capacitorjs.com/docs/android/deploying-to-google-play'],
          ['Firmar tu app', 'https://developer.android.com/studio/publish/app-signing'],
          ['cap build', 'https://capacitorjs.com/docs/cli/commands/build'],
        ],
      },
      {
        id: 'ios-build',
        title: 'Build iOS: Xcode, signing y App Store Connect',
        tags: ['Xcode', 'signing', 'Team', 'Bundle Identifier', 'Archive', 'TestFlight', 'MARKETING_VERSION'],
        summary: "Se compila y firma en macOS con Xcode. Versión (`MARKETING_VERSION`) y build (`CURRENT_PROJECT_VERSION`) se definen en el target; se sube con Product → Archive.",
        when: ["Cada release a TestFlight / App Store."],
        blocks: [
          {
            t: 'list',
            ordered: true,
            items: [
              "`npx ng build --configuration production && npx cap sync ios && npx cap open ios`.",
              "Target **App** → Signing & Capabilities: Team, Bundle Identifier, *Automatically manage signing* (o perfiles manuales).",
              "General → Identity: **Version** (p. ej. 1.2.3) y **Build** (entero creciente).",
              "Selecciona *Any iOS Device (arm64)* → Product → **Archive**.",
              "Organizer → Distribute App → App Store Connect → Upload.",
              "En App Store Connect: TestFlight para pruebas internas/externas; después envío a revisión.",
            ],
          },
          {
            t: 'code',
            lang: 'bash',
            title: 'Versionado desde CLI',
            code: code`
              cd ios/App
              xcrun agvtool new-marketing-version 1.2.3   # Version
              xcrun agvtool new-version -all 45           # Build number
              # (requires "Versioning System: Apple Generic" in Build Settings)
            `,
          },
          {
            t: 'note',
            kind: 'info',
            text: "Según la versión de Capacitor y cómo se creó la plataforma, el proyecto se abre como `App.xcworkspace` (CocoaPods) o `App.xcodeproj` (SPM); `npx cap open ios` abre el correcto ⚠ verificar. Revisa la versión mínima de Xcode requerida por Capacitor 8.",
          },
        ],
        pitfalls: [
          "Abrir `App.xcodeproj` cuando el proyecto usa CocoaPods: errores \"No such module 'Capacitor'\".",
          "Reutilizar el mismo número de Build: App Store Connect rechaza la subida.",
          "Falta de textos `NS…UsageDescription`: rechazo en revisión o crash.",
          "Capabilities (Push, Associated Domains) activadas en Xcode pero no en el App ID del portal (con firma manual).",
        ],
        links: [
          ['Deploying to App Store', 'https://capacitorjs.com/docs/ios/deploying-to-app-store'],
          ['Capacitor iOS', 'https://capacitorjs.com/docs/ios'],
        ],
      },
      {
        id: 'iconos-splash',
        title: 'Íconos y splash con `@capacitor/assets`',
        tags: ['@capacitor/assets', 'capacitor-assets generate', 'icon-only.png', 'splash.png', 'adaptive icon'],
        summary: "Genera todos los tamaños de íconos (incluidos adaptive icons de Android) y splash screens para Android, iOS y PWA desde unas pocas imágenes fuente.",
        when: ["Al crear la app, al cambiar la marca, y tras migrar desde Cordova."],
        blocks: [
          {
            t: 'code',
            lang: 'text',
            title: 'Archivos fuente (carpeta assets/ en la raíz)',
            code: code`
              assets/
              ├── icon-only.png          # 1024x1024, full icon
              ├── icon-foreground.png    # 1024x1024, Android adaptive foreground (transparent bg)
              ├── icon-background.png    # 1024x1024, Android adaptive background
              ├── splash.png             # 2732x2732, logo centered with safe margin
              └── splash-dark.png        # 2732x2732, dark mode variant
            `,
          },
          {
            t: 'code',
            lang: 'bash',
            code: code`
              npm install -D @capacitor/assets

              npx capacitor-assets generate
              npx capacitor-assets generate --android        # one platform only (--ios, --pwa)
              npx capacitor-assets generate \
                --iconBackgroundColor '#ffffff' --iconBackgroundColorDark '#111111' \
                --splashBackgroundColor '#ffffff' --splashBackgroundColorDark '#111111'
            `,
          },
        ],
        pitfalls: [
          "Logo pegado a los bordes en `icon-foreground.png`: Android recorta el adaptive icon (deja ~30% de margen).",
          "Esperar un splash a pantalla completa en Android 12+: el sistema solo muestra icono centrado sobre color.",
          "Generar y no hacer `npx cap sync`/recompilar: sigues viendo los iconos anteriores (a veces hay que desinstalar la app).",
        ],
        links: [
          ['@capacitor/assets', 'https://github.com/ionic-team/capacitor-assets'],
          ['Splash Screens and Icons', 'https://capacitorjs.com/docs/guides/splash-screens-and-icons'],
        ],
      },
      {
        id: 'live-updates',
        title: 'Live Updates / Appflow (breve)',
        tags: ['Live Updates', 'Appflow', 'OTA', 'Capgo', 'canales'],
        summary: "Las actualizaciones OTA reemplazan el bundle web (`www`) sin pasar por la tienda. Solo pueden cambiar código web; cualquier cambio nativo (plugins, permisos, Capacitor) requiere nueva versión en tienda.",
        when: ["Hotfixes de UI/lógica web urgentes; despliegues frecuentes a QA."],
        blocks: [
          {
            t: 'table',
            head: ['Opción', 'Notas'],
            rows: [
              ['Ionic Appflow (Live Updates)', 'Servicio de Ionic con canales y builds en la nube ⚠ verificar estado actual del producto y planes.'],
              ['Capgo (`@capgo/capacitor-updater`)', 'Alternativa comercial/open source con self-hosting ⚠ verificar.'],
              ['Solución propia', 'Descarga de zip + verificación de firma + cambio de ruta del servidor. Solo si tienes el equipo para mantenerla.'],
            ],
          },
          {
            t: 'list',
            items: [
              "Asocia cada bundle web a la **versión nativa compatible** (canal por versión binaria).",
              "Firma/verifica los bundles y permite rollback.",
              "Respeta las políticas de Apple y Google: no cambiar el propósito de la app vía OTA.",
            ],
          },
        ],
        pitfalls: [
          "Enviar por OTA código que llama a un plugin nativo que la versión instalada no tiene: crash o \"not implemented\".",
          "Sin rollback: un bundle roto deja a todos los usuarios con la app inutilizable.",
        ],
        links: [
          ['Appflow docs', 'https://ionic.io/docs/appflow'],
          ['Live Updates', 'https://ionic.io/docs/appflow/deploy/intro'],
        ],
      },
      {
        id: 'pwa',
        title: 'PWA y despliegue web con Nginx',
        tags: ['PWA', '@angular/pwa', 'service worker', 'manifest', 'pwa-elements', 'nginx', 'try_files'],
        summary: "La misma app Ionic puede publicarse como PWA: añade el service worker de Angular, el manifest y sirve `www/` con un servidor que redirija las rutas a `index.html`.",
        when: ["Versión web de la app, demos para clientes, usuarios sin instalación."],
        blocks: [
          {
            t: 'code',
            lang: 'bash',
            code: code`
              npx ng add @angular/pwa                 # service worker + manifest.webmanifest + icons
              npm install @ionic/pwa-elements         # camera/toast UIs for the web plugin implementations
              npx capacitor-assets generate --pwa     # PWA icons from assets/
              npx ng build --configuration production # output: www/
            `,
          },
          {
            t: 'code',
            lang: 'nginx',
            title: 'Nginx para la PWA (SPA con rutas de Angular)',
            file: '/etc/nginx/conf.d/app.conf',
            code: code`
              server {
                  listen 443 ssl;
                  http2 on;
                  server_name app.example.com;
                  root /var/www/app/www;
                  index index.html;

                  # Hashed bundles: cache forever
                  location ~* \.(?:js|css|woff2?|png|jpg|jpeg|webp|avif|svg|ico)$ {
                      expires 1y;
                      add_header Cache-Control "public, max-age=31536000, immutable";
                      try_files $uri =404;
                  }

                  # Never cache the entry point and the service worker files
                  location ~* (?:index\.html|ngsw\.json|ngsw-worker\.js|manifest\.webmanifest)$ {
                      add_header Cache-Control "no-cache";
                      try_files $uri =404;
                  }

                  # Angular routes → index.html
                  location / {
                      try_files $uri $uri/ /index.html;
                  }
              }
            `,
          },
        ],
        pitfalls: [
          "Cachear `index.html` o `ngsw.json`: los usuarios no reciben nuevas versiones.",
          "Sin `try_files … /index.html`: recargar en `/payments/123` da 404.",
          "Esperar APIs nativas en la PWA: usa `Capacitor.isNativePlatform()` y degrada con elegancia.",
          "CORS: la PWA tiene otro origen (`https://app.example.com`) que debe permitirse en la API.",
        ],
        links: [
          ['Ionic PWA', 'https://ionicframework.com/docs/angular/pwa'],
          ['Angular Service Worker', 'https://angular.dev/ecosystem/service-workers'],
          ['Capacitor PWA Elements', 'https://capacitorjs.com/docs/web/pwa-elements'],
        ],
      },
    ],
  },

  /* ===================================================================
     16. TESTING
     =================================================================== */
  {
    id: 'testing',
    num: 16,
    title: 'Testing',
    desc: "Unit tests de páginas y servicios, mocks de plugins de Capacitor y E2E (breve).",
    topics: [
      {
        id: 'unit-paginas',
        title: 'Unit tests de páginas standalone',
        tags: ['TestBed', 'standalone', 'provideIonicAngular', 'Jasmine', 'Vitest', 'spy'],
        summary: "Una página standalone se importa directamente en `TestBed`. Sustituye servicios por dobles y llama a los hooks de Ionic manualmente (TestBed no navega, así que `ionViewWillEnter` no se dispara solo).",
        when: ["Lógica de carga, estados (vacío/error), interacción con servicios y overlays."],
        blocks: [
          {
            t: 'tabs',
            tabs: [
              {
                label: 'Jasmine',
                lang: 'ts',
                file: 'payments.page.spec.ts',
                code: code`
                  import { ComponentFixture, TestBed } from '@angular/core/testing';
                  import { provideIonicAngular } from '@ionic/angular/standalone';
                  import { PaymentsPage } from './payments.page';
                  import { PaymentService } from '../../core/services/payment.service';

                  describe('PaymentsPage', () => {
                    let fixture: ComponentFixture<PaymentsPage>;
                    let api: jasmine.SpyObj<PaymentService>;

                    beforeEach(async () => {
                      api = jasmine.createSpyObj<PaymentService>('PaymentService', ['listAsync']);
                      api.listAsync.and.resolveTo({
                        ok: true,
                        status: 200,
                        data: { items: [{ id: '1', merchant: 'Café', amount: -3.5, date: '2026-11-01' }], hasMore: false },
                        error: null,
                      });

                      await TestBed.configureTestingModule({
                        imports: [PaymentsPage],
                        providers: [provideIonicAngular(), { provide: PaymentService, useValue: api }],
                      }).compileComponents();

                      fixture = TestBed.createComponent(PaymentsPage);
                    });

                    it('loads payments when the page will enter', async () => {
                      fixture.componentInstance.ionViewWillEnter();
                      await fixture.whenStable();
                      expect(api.listAsync).toHaveBeenCalled();
                      expect(fixture.componentInstance.payments().length).toBe(1);
                    });
                  });
                `,
              },
              {
                label: 'Vitest',
                lang: 'ts',
                file: 'payments.page.spec.ts',
                code: code`
                  import { TestBed } from '@angular/core/testing';
                  import { describe, expect, it, vi } from 'vitest';
                  import { provideIonicAngular } from '@ionic/angular/standalone';
                  import { PaymentsPage } from './payments.page';
                  import { PaymentService } from '../../core/services/payment.service';

                  describe('PaymentsPage', () => {
                    it('loads payments when the page will enter', async () => {
                      const api = {
                        listAsync: vi.fn().mockResolvedValue({
                          ok: true, status: 200, error: null,
                          data: { items: [{ id: '1', merchant: 'Café', amount: -3.5, date: '2026-11-01' }], hasMore: false },
                        }),
                      };
                      TestBed.configureTestingModule({
                        imports: [PaymentsPage],
                        providers: [provideIonicAngular(), { provide: PaymentService, useValue: api }],
                      });
                      const fixture = TestBed.createComponent(PaymentsPage);

                      fixture.componentInstance.ionViewWillEnter();
                      await fixture.whenStable();

                      expect(api.listAsync).toHaveBeenCalled();
                      expect(fixture.componentInstance.payments()).toHaveLength(1);
                    });
                  });
                `,
              },
            ],
          },
          {
            t: 'note',
            kind: 'info',
            text: "Las versiones recientes de Angular usan Vitest por defecto en proyectos nuevos; las plantillas de Ionic pueden seguir con Karma + Jasmine ⚠ verificar. Revisa el builder `test` en `angular.json`.",
          },
        ],
        pitfalls: [
          "Olvidar `provideIonicAngular()` en el TestBed: errores al crear controllers u overlays.",
          "Esperar que `ionViewWillEnter` se ejecute al crear la fixture: llámalo explícitamente.",
          "Testear detalles de render de componentes Ionic (Shadow DOM): verifica estado y llamadas, no el HTML interno.",
        ],
        links: [
          ['Testing (Ionic Angular)', 'https://ionicframework.com/docs/angular/testing'],
          ['Angular testing', 'https://angular.dev/guide/testing'],
        ],
      },
      {
        id: 'unit-servicios',
        title: 'Unit tests de servicios HTTP (`ServiceResult`)',
        tags: ['HttpTestingController', 'provideHttpClientTesting', 'flush', 'ServiceResult', 'status 0'],
        summary: "Con `provideHttpClient()` + `provideHttpClientTesting()` interceptas las peticiones y respondes con `flush` (éxito/error HTTP) o `error` (fallo de red → status 0).",
        when: ["Verificar URL, método, body y el mapeo a `ServiceResult<T>` de cada status relevante."],
        blocks: [
          {
            t: 'code',
            lang: 'ts',
            file: 'payment.service.spec.ts',
            code: code`
              import { TestBed } from '@angular/core/testing';
              import { provideHttpClient } from '@angular/common/http';
              import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
              import { firstValueFrom } from 'rxjs';
              import { PaymentService } from './payment.service';
              import { environment } from '../../../environments/environment';

              describe('PaymentService', () => {
                let service: PaymentService;
                let http: HttpTestingController;
                const url = environment.apiUrl + '/payments';

                beforeEach(() => {
                  TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting()] });
                  service = TestBed.inject(PaymentService);
                  http = TestBed.inject(HttpTestingController);
                });

                afterEach(() => http.verify());

                it('returns ok + status on success', async () => {
                  const p = firstValueFrom(service.getById('1'));
                  const req = http.expectOne(url + '/1');
                  expect(req.request.method).toBe('GET');
                  req.flush({ id: '1', merchant: 'Café', amount: 3.5, date: '2026-11-01' }, { status: 200, statusText: 'OK' });

                  const res = await p;
                  expect(res.ok).toBeTrue();
                  expect(res.status).toBe(200);
                  expect(res.data?.merchant).toBe('Café');
                });

                it('maps ProblemDetails on 422', async () => {
                  const p = firstValueFrom(service.create({ merchant: '', amount: 0, date: '' }));
                  http.expectOne(url).flush({ title: 'Validation failed', errors: { merchant: ['Required'] } },
                                            { status: 422, statusText: 'Unprocessable Entity' });
                  const res = await p;
                  expect(res.ok).toBeFalse();
                  expect(res.status).toBe(422);
                  expect(res.error?.message).toBe('Validation failed');
                });

                it('returns status 0 on network failure', async () => {
                  const p = firstValueFrom(service.getById('1'));
                  http.expectOne(url + '/1').error(new ProgressEvent('error'));
                  const res = await p;
                  expect(res.status).toBe(0);
                });
              });
            `,
          },
        ],
        pitfalls: [
          "Olvidar `http.verify()`: no detectas peticiones inesperadas.",
          "Usar `HttpClientTestingModule` (API antigua) mezclado con `provideHttpClient()`: usa las funciones `provide*`.",
          "No testear el caso `status 0`: es el más frecuente en móvil.",
        ],
        links: [['Testing HttpClient', 'https://angular.dev/guide/http/testing']],
      },
      {
        id: 'mocks-capacitor',
        title: 'Mocks de plugins de Capacitor',
        tags: ['mock', 'adaptador', 'vi.mock', 'jest.mock', 'Capacitor', 'plugins'],
        summary: "La forma más robusta: envolver cada plugin en un **servicio adaptador** y sustituir ese servicio en los tests. Con Vitest/Jest también puedes mockear el módulo del plugin.",
        when: ["Cualquier página o servicio que use cámara, preferencias, red, push, etc."],
        blocks: [
          {
            t: 'tabs',
            tabs: [
              {
                label: 'Adaptador',
                lang: 'ts',
                file: 'core/native/camera.adapter.ts',
                code: code`
                  import { Injectable } from '@angular/core';
                  import { Camera, CameraResultType, CameraSource, Photo } from '@capacitor/camera';

                  @Injectable({ providedIn: 'root' })
                  export class CameraAdapter {
                    takePhoto(): Promise<Photo> {
                      return Camera.getPhoto({ quality: 80, resultType: CameraResultType.Uri, source: CameraSource.Prompt });
                    }
                  }

                  // In the test:
                  // providers: [{ provide: CameraAdapter, useValue: { takePhoto: () => Promise.resolve({ webPath: 'blob:x', format: 'jpeg', saved: false }) } }]
                `,
              },
              {
                label: 'Vitest (módulo)',
                lang: 'ts',
                code: code`
                  import { vi } from 'vitest';

                  vi.mock('@capacitor/preferences', () => ({
                    Preferences: {
                      get: vi.fn().mockResolvedValue({ value: '"es"' }),
                      set: vi.fn().mockResolvedValue(undefined),
                      remove: vi.fn().mockResolvedValue(undefined),
                    },
                  }));

                  vi.mock('@capacitor/core', async (importOriginal) => ({
                    ...(await importOriginal<typeof import('@capacitor/core')>()),
                    Capacitor: { isNativePlatform: () => true, getPlatform: () => 'android' },
                  }));
                `,
              },
              {
                label: 'Jasmine (spy)',
                lang: 'ts',
                code: code`
                  // Plugin objects are Proxies: spying on them directly is unreliable.
                  // Spy on your adapter instead:
                  const camera = jasmine.createSpyObj<CameraAdapter>('CameraAdapter', ['takePhoto']);
                  camera.takePhoto.and.resolveTo({ webPath: 'blob:x', format: 'jpeg', saved: false });

                  TestBed.configureTestingModule({
                    imports: [ProfilePage],
                    providers: [provideIonicAngular(), { provide: CameraAdapter, useValue: camera }],
                  });
                `,
              },
            ],
          },
        ],
        pitfalls: [
          "`spyOn(Camera, 'getPhoto')` directamente sobre el proxy del plugin: puede no funcionar o filtrarse entre tests.",
          "Tests que dependen de la implementación web real (p. ej. `Preferences` usando `localStorage` del navegador): estado compartido entre tests.",
        ],
        links: [
          ['Testing (Ionic Angular)', 'https://ionicframework.com/docs/angular/testing'],
          ['Vitest mocking', 'https://vitest.dev/guide/mocking'],
        ],
      },
      {
        id: 'e2e',
        title: 'E2E (breve): Playwright en web y Appium en dispositivo',
        tags: ['E2E', 'Playwright', 'Cypress', 'Appium', 'WebdriverIO', 'shadow DOM', 'route mock'],
        summary: "Para flujos de UI, ejecuta Playwright contra `ionic serve` con viewport móvil y API mockeada. Para validar plugins nativos, Appium/WebdriverIO sobre el APK/IPA cambiando al contexto WEBVIEW.",
        when: ["Flujos críticos (login, pago) en CI; smoke tests sobre el binario antes de publicar."],
        blocks: [
          {
            t: 'code',
            lang: 'ts',
            file: 'e2e/checkout.spec.ts',
            code: code`
              import { expect, test } from '@playwright/test';

              test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

              test('pays with a valid card', async ({ page }) => {
                // Mock the API
                await page.route('**/api/payments', (route) =>
                  route.fulfill({ status: 201, json: { receiptId: 'r-1', authorizationCode: 'A1' } }),
                );

                await page.goto('http://localhost:8100/checkout?amount=25');

                // ion-input renders a native <input> inside: target it directly
                await page.locator('ion-input[formcontrolname="holder"] input').fill('ANA PEREZ');
                await page.locator('ion-input[formcontrolname="cardNumber"] input').fill('4242424242424242');
                await page.locator('ion-input[formcontrolname="expiry"] input').fill('1230');
                await page.locator('ion-input[formcontrolname="cvv"] input').fill('123');
                await page.locator('ion-checkbox[formcontrolname="acceptTerms"]').click();

                await page.getByRole('button', { name: /Pagar/ }).click(); // Playwright pierces open shadow DOM
                await expect(page).toHaveURL(/receipt\/r-1/);
              });
            `,
          },
        ],
        pitfalls: [
          "Esperas fijas (`waitForTimeout`) para animaciones de Ionic: usa aserciones con auto-espera.",
          "Probar plugins nativos en E2E web: se ejecuta la implementación web.",
          "Selectores por clases internas de Ionic: cambian entre versiones. Usa roles, `data-testid` o `formcontrolname`.",
        ],
        links: [
          ['Playwright', 'https://playwright.dev/docs/intro'],
          ['Appium', 'https://appium.io/docs/en/latest/'],
        ],
      },
    ],
  },

  /* ===================================================================
     17. TROUBLESHOOTING
     =================================================================== */
  {
    id: 'troubleshooting',
    num: 17,
    title: 'Troubleshooting',
    desc: "Errores frecuentes y su solución: `cap sync` olvidado, CORS, `10.0.2.2`, cleartext, permisos, Gradle/JDK, estilos y Shadow DOM, pantalla en blanco.",
    topics: [
      {
        id: 'cambios-no-aparecen',
        title: '\"Mis cambios no aparecen en el dispositivo\" (`cap sync` olvidado)',
        tags: ['cap sync', 'cap copy', 'build', 'www', 'cache'],
        summary: "El proyecto nativo usa una copia de `www/` dentro de `android/app/src/main/assets/public` y `ios/App/App/public`. Si no compilas y sincronizas, ejecutas código viejo.",
        when: ["Cambios de TS/HTML que se ven en `ionic serve` pero no en el dispositivo; plugin instalado que \"no existe\"."],
        blocks: [
          {
            t: 'code',
            lang: 'bash',
            code: code`
              npx ng build            # 1. fresh web build
              npx cap sync            # 2. copy + update native plugins
              npx cap run android     # 3. reinstall (or Run from Android Studio / Xcode)

              # Still stale? clean native builds
              cd android && ./gradlew clean && cd ..
              # iOS: Xcode → Product → Clean Build Folder (Shift+Cmd+K)
            `,
          },
        ],
        pitfalls: [
          "Ejecutar desde Android Studio sin `sync` previo tras un build web.",
          "App con `server.url` de una sesión de live reload anterior: carga tu PC, no el bundle (ver [Live reload](#/inicio-cli/live-reload)).",
        ],
        links: [['Workflow', 'https://capacitorjs.com/docs/basics/workflow']],
      },
      {
        id: 'cors-dispositivo',
        title: 'CORS en dispositivo',
        tags: ['CORS', 'https://localhost', 'capacitor://localhost', 'ASP.NET Core', 'Spring Boot', 'preflight'],
        summary: "En dispositivo el origen es `https://localhost` (Android) o `capacitor://localhost` (iOS). El backend debe incluirlos en su política CORS (o usar `CapacitorHttp`).",
        when: ["Error `blocked by CORS policy` o `status 0` solo en el móvil."],
        blocks: [
          {
            t: 'tabs',
            tabs: [
              {
                label: 'ASP.NET Core',
                lang: 'csharp',
                file: 'Program.cs',
                code: code`
                  var builder = WebApplication.CreateBuilder(args);
                  const string MobileCors = "mobile";

                  builder.Services.AddCors(options =>
                  {
                      options.AddPolicy(MobileCors, policy => policy
                          .WithOrigins(
                              "https://localhost",        // Android (Capacitor default)
                              "capacitor://localhost",    // iOS
                              "http://localhost:8100",    // ionic serve
                              "https://app.example.com")  // PWA
                          .AllowAnyHeader()
                          .AllowAnyMethod());
                  });
                  builder.Services.AddControllers();

                  var app = builder.Build();
                  app.UseRouting();
                  app.UseCors(MobileCors);       // after UseRouting, before auth
                  app.UseAuthentication();
                  app.UseAuthorization();
                  app.MapControllers();
                  app.Run();
                `,
              },
              {
                label: 'Spring Boot',
                lang: 'java',
                file: 'CorsConfig.java',
                code: code`
                  @Configuration
                  public class CorsConfig implements WebMvcConfigurer {
                      @Override
                      public void addCorsMappings(CorsRegistry registry) {
                          registry.addMapping("/api/**")
                              .allowedOrigins("https://localhost", "capacitor://localhost", "http://localhost:8100")
                              .allowedMethods("GET", "POST", "PUT", "DELETE", "OPTIONS")
                              .allowedHeaders("*");
                      }
                  }
                  // With Spring Security also enable: http.cors(Customizer.withDefaults())
                `,
              },
              {
                label: 'Alternativa: nativo',
                lang: 'ts',
                file: 'capacitor.config.ts',
                code: code`
                  plugins: {
                    CapacitorHttp: { enabled: true }, // requests leave from native code → no CORS on device
                  },
                `,
              },
            ],
          },
        ],
        pitfalls: [
          "Permitir `*` con credenciales: el navegador lo rechaza; lista los orígenes.",
          "`UseCors` en el orden incorrecto en ASP.NET Core: el preflight `OPTIONS` falla con 401/405.",
          "Olvidar el origen de la migración Cordova (`http://localhost`, `ionic://localhost`) si conservaste esos esquemas.",
        ],
        links: [
          ['CORS en ASP.NET Core', 'https://learn.microsoft.com/aspnet/core/security/cors'],
          ['CORS (Ionic)', 'https://ionicframework.com/docs/troubleshooting/cors'],
        ],
      },
      {
        id: 'localhost-10-0-2-2',
        title: '`localhost` no funciona: `10.0.2.2`, IP de LAN y `adb reverse`',
        tags: ['10.0.2.2', 'localhost', 'emulador', 'adb reverse', 'Kestrel', '0.0.0.0'],
        summary: "Dentro del emulador/dispositivo, `localhost` es el propio dispositivo. Para llegar a la API que corre en tu PC usa la dirección adecuada según el entorno.",
        when: ["Desarrollo contra un backend local (ASP.NET Core, Spring Boot) desde emulador o móvil."],
        blocks: [
          {
            t: 'table',
            head: ['Dónde corre la app', 'URL de tu PC', 'Notas'],
            rows: [
              ['Emulador Android', '`http://10.0.2.2:<puerto>`', 'Alias del host del emulador.'],
              ['Simulador iOS (Mac)', '`http://localhost:<puerto>`', 'Comparte la red del Mac.'],
              ['Dispositivo físico (Wi-Fi)', '`http://192.168.x.x:<puerto>`', 'El backend debe escuchar en `0.0.0.0` y el firewall permitirlo.'],
              ['Dispositivo Android por USB', '`http://localhost:<puerto>` tras `adb reverse`', 'No depende de la Wi-Fi.'],
            ],
          },
          {
            t: 'code',
            lang: 'bash',
            code: code`
              # Android over USB: device's localhost:5000 → PC's localhost:5000
              adb reverse tcp:5000 tcp:5000

              # ASP.NET Core: listen on all interfaces (not just localhost)
              dotnet run --urls "http://0.0.0.0:5000"

              # Spring Boot
              ./mvnw spring-boot:run -Dspring-boot.run.arguments=--server.address=0.0.0.0
            `,
          },
        ],
        pitfalls: [
          "Backend escuchando solo en `localhost`/`127.0.0.1`: inalcanzable desde la LAN.",
          "Certificado HTTPS de desarrollo (autofirmado): el dispositivo lo rechaza. Usa http en dev (ver cleartext) o un túnel (dev tunnels, ngrok).",
          "Olvidar que `adb reverse` se pierde al desconectar el cable.",
        ],
        links: [['Android emulator networking', 'https://developer.android.com/studio/run/emulator-networking']],
      },
      {
        id: 'cleartext',
        title: 'HTTP en claro bloqueado en Android (cleartext / mixed content)',
        tags: ['ERR_CLEARTEXT_NOT_PERMITTED', 'cleartext', 'network_security_config', 'mixed content', 'allowMixedContent'],
        summary: "Android 9+ bloquea `http://` por defecto. Además, la app corre en `https://localhost`, así que una petición `http://` desde el WebView es **mixed content**. En desarrollo hay que permitir ambas cosas de forma acotada.",
        when: ["`net::ERR_CLEARTEXT_NOT_PERMITTED` o peticiones a `http://10.0.2.2` que fallan con status 0."],
        blocks: [
          {
            t: 'code',
            lang: 'xml',
            file: 'android/app/src/debug/res/xml/network_security_config.xml (solo debug)',
            code: code`
              <?xml version="1.0" encoding="utf-8"?>
              <network-security-config>
                  <domain-config cleartextTrafficPermitted="true">
                      <domain includeSubdomains="false">10.0.2.2</domain>
                      <domain includeSubdomains="false">192.168.1.10</domain>
                  </domain-config>
              </network-security-config>

              <!-- AndroidManifest.xml: android:networkSecurityConfig="@xml/network_security_config"
                   (provide a strict version in src/main/res/xml for release) -->
            `,
          },
          {
            t: 'table',
            head: ['Opción', 'Ámbito', 'Uso'],
            rows: [
              ['`server.cleartext: true`', 'Toda la app', 'Live reload contra `http://<ip>:8100`.'],
              ['`network_security_config` en `src/debug`', 'Dominios concretos, solo debug', 'Backend local en http.'],
              ['`android.allowMixedContent: true`', 'WebView', 'Permite `http://` desde `https://localhost` (solo dev).'],
              ['`CapacitorHttp`', 'Peticiones nativas', 'Evita el mixed content del WebView.'],
            ],
          },
        ],
        pitfalls: [
          "Poner `usesCleartextTraffic=\"true\"` global en release.",
          "Permitir cleartext pero no mixed content (o al revés) y no entender por qué sigue fallando.",
        ],
        links: [
          ['Network security config', 'https://developer.android.com/privacy-and-security/security-config'],
          ['Capacitor config', 'https://capacitorjs.com/docs/config'],
        ],
      },
      {
        id: 'permisos',
        title: 'Permisos: `AndroidManifest.xml` e `Info.plist`',
        tags: ['permisos', 'AndroidManifest', 'Info.plist', 'UsageDescription', 'POST_NOTIFICATIONS', 'crash'],
        summary: "iOS cierra la app si usas una API protegida sin su clave `NS…UsageDescription`. Android devuelve `denied` o falla si falta el `uses-permission`.",
        when: ["Crash al abrir cámara/ubicación en iOS; permiso siempre `denied` en Android; rechazo en revisión de Apple."],
        blocks: [
          {
            t: 'table',
            head: ['Función', 'Android (`uses-permission`)', 'iOS (`Info.plist`)'],
            rows: [
              ['Cámara', '`CAMERA`', '`NSCameraUsageDescription`'],
              ['Galería', 'según versión/plugin ⚠ verificar', '`NSPhotoLibraryUsageDescription`, `NSPhotoLibraryAddUsageDescription`'],
              ['Ubicación', '`ACCESS_COARSE_LOCATION`, `ACCESS_FINE_LOCATION`', '`NSLocationWhenInUseUsageDescription` (+ `Always…`)'],
              ['Micrófono', '`RECORD_AUDIO`', '`NSMicrophoneUsageDescription`'],
              ['Notificaciones', '`POST_NOTIFICATIONS` (Android 13+, pedido por el plugin)', 'Capability Push Notifications'],
              ['Face ID / huella', '`USE_BIOMETRIC`', '`NSFaceIDUsageDescription`'],
              ['Contactos', '`READ_CONTACTS`', '`NSContactsUsageDescription`'],
            ],
          },
        ],
        pitfalls: [
          "Textos genéricos (\"Necesitamos permiso\"): Apple rechaza la app; explica el uso concreto.",
          "Pedir todos los permisos al inicio: mayor tasa de rechazo.",
          "Asumir que tras `denied` el sistema vuelve a preguntar.",
        ],
        links: [
          ['Android permissions', 'https://developer.android.com/guide/topics/permissions/overview'],
          ['iOS: Info.plist keys', 'https://developer.apple.com/documentation/bundleresources/information-property-list'],
        ],
      },
      {
        id: 'gradle-jdk',
        title: 'Gradle / JDK incompatibles',
        tags: ['Gradle', 'JDK', 'JAVA_HOME', 'Unsupported class file major version', 'AGP', 'gradlew clean'],
        summary: "Cada versión de Capacitor fija versiones de Android Gradle Plugin (AGP), Gradle y JDK. Usar otro JDK provoca errores de compilación crípticos.",
        when: ["`Unsupported class file major version …`, `Android Gradle plugin requires Java 21`, fallos tras actualizar Capacitor o Android Studio."],
        blocks: [
          {
            t: 'code',
            lang: 'bash',
            code: code`
              # Which JDK/Gradle is used?
              cd android
              ./gradlew --version           # Windows: gradlew.bat --version

              # Clean and rebuild
              ./gradlew clean
              ./gradlew assembleDebug --stacktrace
            `,
          },
          {
            t: 'code',
            lang: 'powershell',
            title: 'Windows: apuntar JAVA_HOME al JDK de Android Studio (sesión actual)',
            code: code`
              $env:JAVA_HOME = "C:\Program Files\Android\Android Studio\jbr"
              $env:Path = "$env:JAVA_HOME\bin;$env:Path"
              java -version
            `,
          },
          {
            t: 'list',
            items: [
              "Android Studio → Settings → Build, Execution, Deployment → Build Tools → Gradle → **Gradle JDK** = JBR/JDK 21 (Capacitor 7+) ⚠ verificar para tu versión.",
              "Versiones de AGP en `android/build.gradle` y de Gradle en `android/gradle/wrapper/gradle-wrapper.properties`: usa las que trae la plantilla de tu versión de Capacitor (o `npx cap migrate`).",
              "File → Invalidate Caches / Restart si el IDE sigue mostrando errores antiguos.",
            ],
          },
        ],
        pitfalls: [
          "Actualizar AGP desde el asistente de Android Studio sin que Capacitor lo soporte.",
          "JDK distinto en terminal y en Android Studio: \"funciona en uno y no en otro\".",
          "Plugins comunitarios desactualizados que fijan versiones antiguas de Kotlin/AGP.",
        ],
        links: [
          ['Updating Capacitor', 'https://capacitorjs.com/docs/updating/8-0'],
          ['Android environment setup', 'https://capacitorjs.com/docs/getting-started/environment-setup'],
        ],
      },
      {
        id: 'estilos-shadow-dom',
        title: 'Estilos que no aplican (Shadow DOM, `::part`, overlays)',
        tags: ['estilos', 'shadow DOM', '::part', 'CSS variables', 'ng-deep', 'cssClass', 'global.scss'],
        summary: "Si un estilo no se aplica a un `ion-*`, casi siempre es porque intentas tocar elementos dentro del Shadow DOM, o porque el overlay se renderiza fuera del componente.",
        when: ["Botones, inputs, modales o toasts que ignoran tu CSS."],
        blocks: [
          {
            t: 'tabs',
            tabs: [
              {
                label: '✕ No funciona',
                lang: 'scss',
                code: code`
                  ion-button button { border-radius: 20px; }      // inner <button> is in shadow DOM
                  ion-button { background: red; }                 // host background is not the visible one
                  ::ng-deep ion-modal .modal-wrapper { … }         // ng-deep does not pierce shadow DOM
                `,
              },
              {
                label: '✓ Funciona',
                lang: 'scss',
                code: code`
                  ion-button {
                    --background: var(--ion-color-danger);
                    --border-radius: 20px;
                  }
                  ion-button::part(native) { text-transform: none; }

                  // global.scss (overlays live in ion-app, not in your page)
                  ion-modal.payment-sheet { --border-radius: 16px; --height: auto; }
                  ion-modal.payment-sheet::part(content) { max-width: 560px; }
                `,
              },
              {
                label: 'TypeScript',
                lang: 'ts',
                code: code`
                  await this.modalCtrl.create({ component: PaySheet, cssClass: 'payment-sheet' });
                `,
              },
            ],
          },
          {
            t: 'list',
            title: 'Orden de diagnóstico',
            ordered: true,
            items: [
              "¿Existe una variable CSS documentada en la API del componente? Úsala.",
              "¿Hay una shadow part? Usa `::part(nombre)`.",
              "¿Es un overlay? Mueve el estilo a `global.scss` y usa `cssClass`.",
              "Inspecciona con DevTools (muestra `#shadow-root`) para ver qué elemento tiene realmente el estilo.",
            ],
          },
        ],
        pitfalls: [
          "Subir la especificidad o usar `!important` sin entender la causa.",
          "Estilar por clases internas de Ionic (`.button-native`): cambian entre versiones.",
        ],
        links: [
          ['CSS Shadow Parts', 'https://ionicframework.com/docs/theming/css-shadow-parts'],
          ['CSS Variables', 'https://ionicframework.com/docs/theming/css-variables'],
        ],
      },
      {
        id: 'pantalla-blanca',
        title: 'Pantalla en blanco al abrir la app',
        tags: ['pantalla blanca', 'white screen', 'webDir', 'server.url', 'chrome://inspect', 'base href'],
        summary: "Casi siempre es un error JS al arrancar, assets que no están donde Capacitor los busca, o una URL de live reload olvidada.",
        when: ["La app abre y se queda en blanco (o en el splash) en dispositivo."],
        blocks: [
          {
            t: 'table',
            head: ['Comprobar', 'Cómo'],
            rows: [
              ['Errores JS', 'Android: `chrome://inspect`; iOS: Safari → Desarrollo → dispositivo → consola.'],
              ['`webDir`', 'Que `www/index.html` exista tras el build (no `www/browser/index.html`).'],
              ['`server.url`', 'Que no quede en `capacitor.config.ts` ni en el `capacitor.config.json` nativo.'],
              ['`<base href=\"/\">`', 'Presente en `src/index.html`.'],
              ['Splash', '`launchAutoHide: false` sin `SplashScreen.hide()` → parece blanco/congelado.'],
              ['WebView antiguo', 'Android System WebView desactualizado en el dispositivo/emulador.'],
              ['Plugins Cordova incompatibles', 'Tras migración (ionic-webview, splashscreen…).'],
            ],
          },
        ],
        pitfalls: [
          "Depurar solo con `adb logcat` y no abrir la consola del WebView, donde está el error real.",
          "Probar solo en release (sin depuración del WebView): reproduce en debug primero.",
        ],
        links: [['Debugging', 'https://capacitorjs.com/docs/vscode/debugging']],
      },
      {
        id: 'plugin-not-implemented',
        title: '`"X" plugin is not implemented on android/ios`',
        tags: ['not implemented', 'cap sync', 'registerPlugin', 'nombre del plugin', 'web'],
        summary: "El proxy JS no encuentra la implementación nativa con ese nombre en la plataforma actual.",
        when: ["Al llamar a cualquier plugin tras instalarlo, migrar o crear uno propio."],
        blocks: [
          {
            t: 'list',
            ordered: true,
            items: [
              "¿Hiciste `npx cap sync` después de instalar? ¿Recompilaste el binario?",
              "`npx cap ls` muestra el plugin para esa plataforma?",
              "En web: ¿el plugin tiene implementación web? Protege con `Capacitor.isNativePlatform()` o `isPluginAvailable()`.",
              "Plugin propio: nombres iguales en `registerPlugin`, `@CapacitorPlugin(name)` y `jsName`; registrado si es código local.",
              "Versiones: mismo major que `@capacitor/core`.",
            ],
          },
        ],
        pitfalls: [
          "Instalar el plugin en un workspace distinto (monorepo) al que usa `npx cap`.",
        ],
        links: [['Plugins', 'https://capacitorjs.com/docs/plugins']],
      },
      {
        id: 'ios-dependencias',
        title: 'iOS: CocoaPods / Swift Package Manager',
        tags: ['pod install', 'CocoaPods', 'SPM', 'No such module Capacitor', 'Package.resolved'],
        summary: "Errores de dependencias nativas en iOS tras instalar plugins o actualizar Capacitor.",
        when: ["`No such module 'Capacitor'`, `pod install` falla, paquetes SPM que no resuelven."],
        blocks: [
          {
            t: 'tabs',
            tabs: [
              {
                label: 'CocoaPods',
                lang: 'bash',
                code: code`
                  cd ios/App
                  pod repo update
                  pod install
                  # Open App.xcworkspace (NOT App.xcodeproj)
                `,
              },
              {
                label: 'SPM',
                lang: 'bash',
                code: code`
                  npx cap sync ios
                  # Xcode → File → Packages → Reset Package Caches, then Resolve Package Versions
                `,
              },
            ],
          },
        ],
        pitfalls: [
          "Abrir el `.xcodeproj` en un proyecto con Pods.",
          "Mezclar plugins que solo soportan CocoaPods en un proyecto SPM ⚠ verificar compatibilidad de cada plugin.",
        ],
        links: [['Capacitor iOS', 'https://capacitorjs.com/docs/ios']],
      },
      {
        id: 'teclado-tapa-inputs',
        title: 'El teclado tapa los inputs o el botón inferior',
        tags: ['teclado', 'keyboard', 'resize', 'adjustResize', 'ion-footer', 'scroll assist'],
        summary: "Depende del modo de resize del WebView, de si el input está dentro de `ion-content` y de cómo se posicionan los footers.",
        when: ["Formularios largos (pago, registro) en dispositivos pequeños."],
        blocks: [
          {
            t: 'list',
            items: [
              "Inputs siempre dentro de `ion-content` (no en divs con scroll propio).",
              "Android: `android:windowSoftInputMode=\"adjustResize\"` en la activity; con edge-to-edge revisa `resizeOnFullScreen` del plugin Keyboard.",
              "iOS: prueba `resize: 'native'` o `'body'` en la config del plugin Keyboard.",
              "Botón de enviar dentro del contenido o en `ion-footer` (que Ionic reposiciona) en lugar de `position: fixed`.",
            ],
          },
        ],
        pitfalls: [
          "Cambiar el modo de resize globalmente para arreglar una pantalla y romper otras: prueba todos los formularios.",
        ],
        links: [
          ['Keyboard (Ionic)', 'https://ionicframework.com/docs/developing/keyboard'],
          ['Keyboard plugin', 'https://capacitorjs.com/docs/apis/keyboard'],
        ],
      },
    ],
  },

  /* ===================================================================
     18. GLOSARIO Y RECURSOS
     =================================================================== */
  {
    id: 'glosario',
    num: 18,
    title: 'Glosario y recursos',
    desc: "Componentes, controllers, plugins, comandos y conceptos con enlaces oficiales.",
    topics: [
      {
        id: 'glosario-componentes',
        title: 'Componentes Ionic',
        tags: ['componentes', 'ion-', 'API', 'referencia'],
        summary: "Índice rápido de componentes y su página de API oficial.",
        when: ["Para saltar a la documentación de un componente concreto."],
        blocks: [
          {
            t: 'table',
            head: ['Componente', 'Para qué', 'En este manual'],
            rows: [
              ['[ion-app](https://ionicframework.com/docs/api/app)', 'Raíz de la app.', '[Estructura](#/inicio-cli/estructura)'],
              ['[ion-router-outlet](https://ionicframework.com/docs/api/router-outlet)', 'Outlet con stack y transiciones.', '[Router outlet](#/navegacion/router-outlet)'],
              ['[ion-tabs](https://ionicframework.com/docs/api/tabs)', 'Navegación por pestañas.', '[Tabs](#/navegacion/tabs)'],
              ['[ion-menu](https://ionicframework.com/docs/api/menu)', 'Menú lateral.', '[Menú](#/navegacion/menu)'],
              ['[ion-header / ion-toolbar](https://ionicframework.com/docs/api/toolbar)', 'Cabecera y barra de herramientas.', '[Layout](#/componentes/layout)'],
              ['[ion-content](https://ionicframework.com/docs/api/content)', 'Área con scroll.', '[Layout](#/componentes/layout)'],
              ['[ion-grid](https://ionicframework.com/docs/api/grid)', 'Grid responsive.', '[Grid](#/componentes/grid)'],
              ['[ion-list / ion-item](https://ionicframework.com/docs/api/list)', 'Listas.', '[Listas](#/componentes/listas)'],
              ['[ion-card](https://ionicframework.com/docs/api/card)', 'Tarjetas.', '[Cards](#/componentes/cards)'],
              ['[ion-button](https://ionicframework.com/docs/api/button)', 'Botones.', '[Botones](#/componentes/botones)'],
              ['[ion-input](https://ionicframework.com/docs/api/input)', 'Campos de texto.', '[Inputs](#/componentes/inputs)'],
              ['[ion-select](https://ionicframework.com/docs/api/select)', 'Selector.', '[Selects](#/componentes/selects)'],
              ['[ion-toggle](https://ionicframework.com/docs/api/toggle) / [ion-checkbox](https://ionicframework.com/docs/api/checkbox) / [ion-radio](https://ionicframework.com/docs/api/radio)', 'Controles de selección.', '[Toggle, checkbox…](#/componentes/toggles-checkbox-radio)'],
              ['[ion-segment](https://ionicframework.com/docs/api/segment)', 'Filtros/sub-vistas.', '[Segment](#/componentes/segment)'],
              ['[ion-searchbar](https://ionicframework.com/docs/api/searchbar)', 'Búsqueda.', '[Searchbar](#/componentes/searchbar)'],
              ['[ion-infinite-scroll](https://ionicframework.com/docs/api/infinite-scroll)', 'Paginación al hacer scroll.', '[Infinite scroll](#/componentes/infinite-scroll)'],
              ['[ion-refresher](https://ionicframework.com/docs/api/refresher)', 'Pull to refresh.', '[Refresher](#/componentes/refresher)'],
              ['[ion-skeleton-text](https://ionicframework.com/docs/api/skeleton-text)', 'Placeholder de carga.', '[Skeleton](#/componentes/skeleton)'],
              ['[ion-modal](https://ionicframework.com/docs/api/modal)', 'Modales y sheets.', '[Modal](#/overlays/modal-controller)'],
              ['[ion-popover](https://ionicframework.com/docs/api/popover)', 'Contenido flotante.', '[Popover](#/overlays/popover)'],
            ],
          },
        ],
        pitfalls: ["Buscar props de Ionic 6 (`ion-label position`, `ion-virtual-scroll`): revisa siempre la versión de la doc."],
        links: [['Todos los componentes', 'https://ionicframework.com/docs/components']],
      },
      {
        id: 'glosario-controllers',
        title: 'Controllers y servicios de Ionic Angular',
        tags: ['controllers', 'ModalController', 'NavController', 'Platform', 'MenuController', 'AnimationController'],
        summary: "Servicios inyectables de `@ionic/angular/standalone`.",
        when: ["Para recordar qué controller usar y dónde está explicado."],
        blocks: [
          {
            t: 'table',
            head: ['Servicio', 'Uso', 'En este manual'],
            rows: [
              ['`ModalController`', 'Crear/cerrar modales.', '[Modal](#/overlays/modal-controller)'],
              ['`AlertController`', 'Diálogos.', '[Alertas](#/overlays/alert)'],
              ['`ToastController`', 'Mensajes breves.', '[Toast](#/overlays/toast)'],
              ['`LoadingController`', 'Overlay de carga.', '[Loading](#/overlays/loading)'],
              ['`ActionSheetController`', 'Hoja de acciones.', '[Action sheet](#/overlays/action-sheet)'],
              ['`PopoverController`', 'Popovers.', '[Popover](#/overlays/popover)'],
              ['`MenuController`', 'Abrir/cerrar/habilitar menús.', '[Menú](#/navegacion/menu)'],
              ['`NavController`', 'Navegación con dirección.', '[NavController](#/navegacion/navcontroller-vs-router)'],
              ['`Platform`', 'Plataforma, ready, pause/resume, back button.', '[Qué corre dónde](#/arquitectura/que-corre-donde)'],
              ['`AnimationController`', 'Animaciones.', '[Animaciones](#/rendimiento/animaciones)'],
              ['`GestureController`', 'Gestos personalizados.', '[Gestures](https://ionicframework.com/docs/utilities/gestures)'],
            ],
          },
        ],
        pitfalls: ["Importarlos desde `@ionic/angular` en una app standalone."],
        links: [['Ionic Angular', 'https://ionicframework.com/docs/angular/overview']],
      },
      {
        id: 'glosario-plugins',
        title: 'Plugins de Capacitor',
        tags: ['plugins', '@capacitor', 'community', 'npm'],
        summary: "Paquetes oficiales y comunitarios usados en este manual.",
        when: ["Para instalar rápidamente o abrir la doc de un plugin."],
        blocks: [
          {
            t: 'table',
            head: ['Paquete', 'Doc', 'En este manual'],
            rows: [
              ['`@capacitor/preferences`', '[Doc](https://capacitorjs.com/docs/apis/preferences)', '[Preferences](#/plugins/preferences)'],
              ['`@capacitor/camera`', '[Doc](https://capacitorjs.com/docs/apis/camera)', '[Camera](#/plugins/camera)'],
              ['`@capacitor/filesystem`', '[Doc](https://capacitorjs.com/docs/apis/filesystem)', '[Filesystem](#/plugins/filesystem)'],
              ['`@capacitor/geolocation`', '[Doc](https://capacitorjs.com/docs/apis/geolocation)', '[Geolocation](#/plugins/geolocation)'],
              ['`@capacitor/network`', '[Doc](https://capacitorjs.com/docs/apis/network)', '[Network](#/plugins/network)'],
              ['`@capacitor/app`', '[Doc](https://capacitorjs.com/docs/apis/app)', '[App](#/plugins/app)'],
              ['`@capacitor/keyboard`', '[Doc](https://capacitorjs.com/docs/apis/keyboard)', '[Keyboard](#/plugins/keyboard)'],
              ['`@capacitor/status-bar`', '[Doc](https://capacitorjs.com/docs/apis/status-bar)', '[StatusBar](#/plugins/status-bar)'],
              ['`@capacitor/splash-screen`', '[Doc](https://capacitorjs.com/docs/apis/splash-screen)', '[SplashScreen](#/plugins/splash-screen)'],
              ['`@capacitor/push-notifications`', '[Doc](https://capacitorjs.com/docs/apis/push-notifications)', '[Push](#/plugins/push-notifications)'],
              ['`@capacitor/local-notifications`', '[Doc](https://capacitorjs.com/docs/apis/local-notifications)', '[Local](#/plugins/local-notifications)'],
              ['`@capacitor/share`', '[Doc](https://capacitorjs.com/docs/apis/share)', '[Share](#/plugins/share)'],
              ['`@capacitor/haptics`', '[Doc](https://capacitorjs.com/docs/apis/haptics)', '[Haptics](#/plugins/haptics)'],
              ['`@capacitor/browser`', '[Doc](https://capacitorjs.com/docs/apis/browser)', '[Browser](#/plugins/browser)'],
              ['`CapacitorHttp` (core)', '[Doc](https://capacitorjs.com/docs/apis/http)', '[HTTP](#/datos-http/httpclient-vs-capacitorhttp)'],
              ['`@capacitor-community/sqlite`', '[GitHub](https://github.com/capacitor-community/sqlite)', '[SQLite](#/datos-http/sqlite)'],
              ['`@capacitor/assets`', '[GitHub](https://github.com/ionic-team/capacitor-assets)', '[Íconos](#/build-despliegue/iconos-splash)'],
            ],
          },
        ],
        pitfalls: ["Instalar plugins comunitarios sin revisar actividad del repo y compatibilidad con tu major de Capacitor."],
        links: [
          ['APIs oficiales', 'https://capacitorjs.com/docs/apis'],
          ['Capacitor Community', 'https://github.com/capacitor-community'],
        ],
      },
      {
        id: 'glosario-comandos',
        title: 'Comandos',
        tags: ['comandos', 'CLI', 'ionic', 'npx cap', 'ng', 'gradlew'],
        summary: "Los comandos más usados en el día a día.",
        when: ["Como chuleta rápida."],
        blocks: [
          {
            t: 'table',
            head: ['Comando', 'Qué hace'],
            rows: [
              ['`ionic start app tabs --type=angular`', 'Crear proyecto.'],
              ['`ionic serve` / `--external`', 'Dev server (8100).'],
              ['`ionic g page pages/x`', 'Generar página.'],
              ['`npx ng build --configuration production`', 'Build web de producción.'],
              ['`npx cap sync [android|ios]`', 'Copiar web + actualizar plugins.'],
              ['`npx cap run android -l --host <ip>`', 'Live reload en dispositivo.'],
              ['`npx cap open android|ios`', 'Abrir IDE nativo.'],
              ['`npx cap doctor` / `npx cap ls`', 'Diagnóstico / plugins detectados.'],
              ['`npx capacitor-assets generate`', 'Íconos y splash.'],
              ['`./gradlew bundleRelease`', 'AAB firmado.'],
              ['`adb reverse tcp:5000 tcp:5000`', 'Exponer puerto del PC al dispositivo USB.'],
              ['`chrome://inspect`', 'Depurar WebView Android.'],
            ],
          },
        ],
        pitfalls: ["Ejecutar comandos de Capacitor desde una carpeta que no es la raíz del proyecto."],
        links: [
          ['Ionic CLI', 'https://ionicframework.com/docs/cli'],
          ['Capacitor CLI', 'https://capacitorjs.com/docs/cli'],
        ],
      },
      {
        id: 'glosario-conceptos',
        title: 'Conceptos',
        tags: ['glosario', 'WebView', 'bridge', 'modo', 'safe area', 'AAB', 'deep link'],
        summary: "Términos que aparecen en todo el manual.",
        when: ["Para aclarar vocabulario con el equipo."],
        blocks: [
          {
            t: 'table',
            head: ['Término', 'Significado'],
            rows: [
              ['WebView', 'Motor de navegador embebido que ejecuta la app web dentro del binario.'],
              ['Bridge', 'Canal asíncrono JS ↔ nativo por el que viajan las llamadas a plugins.'],
              ['Plugin', 'Paquete con API TS + implementación nativa (y opcionalmente web).'],
              ['Modo (`ios`/`md`)', 'Estilo visual de los componentes Ionic.'],
              ['Plataforma', 'Dónde corre la app: android, ios, web (y variantes de `Platform.is`).'],
              ['Stack de páginas', 'Páginas vivas en `ion-router-outlet` según la navegación.'],
              ['Overlay', 'Componente que se muestra sobre la app: modal, alert, toast, popover…'],
              ['Shadow DOM / part', 'Encapsulación de estilos; `::part` expone piezas internas.'],
              ['Safe area', 'Zona no cubierta por notch, barras o indicador de inicio.'],
              ['Live reload / Live update', 'Recarga desde dev server / actualización OTA del bundle web.'],
              ['AAB', 'Android App Bundle: formato de publicación en Google Play.'],
              ['Keystore / Provisioning profile', 'Credenciales de firma en Android / iOS.'],
              ['Deep link / App Link / Universal Link', 'URL que abre una pantalla concreta de la app.'],
              ['`ServiceResult<T>`', 'Convención del proyecto: `{ ok, status, data, error }` en servicios HTTP.'],
            ],
          },
        ],
        pitfalls: ["Usar \"plataforma\" y \"modo\" como sinónimos."],
        links: [['Fundamentos (Ionic)', 'https://ionicframework.com/docs/core-concepts/fundamentals']],
      },
      {
        id: 'recursos',
        title: 'Recursos oficiales',
        tags: ['recursos', 'docs', 'github', 'changelog', 'foro'],
        summary: "Dónde consultar cuando algo no está en este manual o necesitas confirmar un ⚠ verificar.",
        when: ["Siempre que haya duda sobre versión o API."],
        blocks: [
          {
            t: 'list',
            items: [
              "[Ionic Framework docs](https://ionicframework.com/docs) · [Changelog](https://github.com/ionic-team/ionic-framework/blob/main/CHANGELOG.md) · [Guías de actualización](https://ionicframework.com/docs/updating/8-0)",
              "[Capacitor docs](https://capacitorjs.com/docs) · [Guías de actualización](https://capacitorjs.com/docs/updating/8-0) · [GitHub](https://github.com/ionic-team/capacitor)",
              "[Capacitor plugins oficiales (repo)](https://github.com/ionic-team/capacitor-plugins)",
              "[Angular docs](https://angular.dev) · [Angular update guide](https://angular.dev/update-guide)",
              "[Ionic Forum](https://forum.ionicframework.com) · [Capacitor Community](https://github.com/capacitor-community)",
              "[OWASP MAS](https://mas.owasp.org) para seguridad móvil.",
            ],
          },
        ],
        pitfalls: ["Seguir tutoriales de Ionic 4–6 o Capacitor 2–4 sin adaptar: muchas APIs cambiaron (labels, standalone, Preferences, iconos)."],
        links: [
          ['Ionic docs', 'https://ionicframework.com/docs'],
          ['Capacitor docs', 'https://capacitorjs.com/docs'],
        ],
      },
    ],
  },
];
