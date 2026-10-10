import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

function patchFile(relPath, transform) {
  const fullPath = join(process.cwd(), relPath);
  if (!existsSync(fullPath)) {
    console.log(`[PATCH-VOIP] File not found, skipping: ${relPath}`);
    return;
  }
  try {
    const original = readFileSync(fullPath, 'utf8');
    const modified = transform(original);
    if (modified !== original) {
      writeFileSync(fullPath, modified, 'utf8');
      console.log(`✅ [PATCH-VOIP] Patched: ${relPath}`);
    } else {
      console.log(`ℹ️ [PATCH-VOIP] Already patched: ${relPath}`);
    }
  } catch (err) {
    console.warn(`⚠️ [PATCH-VOIP] Could not patch ${relPath}:`, err.message);
  }
}

console.log('🔧 [PATCH-VOIP] Applying IPv4-only VoIP patches...');

// 1. Patch @zapo-js/voip-media plan.js (CommonJS & ESM)
patchFile('node_modules/@zapo-js/voip-media/dist/call/plan.js', (content) => {
  return content.replace(
    'return unique.filter((ep) => ep.key && ep.rawToken);',
    'return unique.filter((ep) => ep.key && ep.rawToken && (!ep.ip || !ep.ip.includes(":")));'
  );
});

patchFile('node_modules/@zapo-js/voip-media/dist/esm/call/plan.js', (content) => {
  return content.replace(
    'return unique.filter((ep) => ep.key && ep.rawToken);',
    'return unique.filter((ep) => ep.key && ep.rawToken && (!ep.ip || !ep.ip.includes(":")));'
  );
});

// 2. Patch @zapo-js/voip relay-ack.js (CommonJS & ESM)
patchFile('node_modules/@zapo-js/voip/dist/relay/relay-ack.js', (content) => {
  return content.replace(
    'relays.sort((a, b) => (a.c2rRtt ?? Infinity) - (b.c2rRtt ?? Infinity));',
    'relays = relays.filter(r => !r.ip || !r.ip.includes(":"));\n    relays.sort((a, b) => (a.c2rRtt ?? Infinity) - (b.c2rRtt ?? Infinity));'
  );
});

patchFile('node_modules/@zapo-js/voip/dist/esm/relay/relay-ack.js', (content) => {
  return content.replace(
    'relays.sort((a, b) => (a.c2rRtt ?? Infinity) - (b.c2rRtt ?? Infinity));',
    'relays = relays.filter(r => !r.ip || !r.ip.includes(":"));\n    relays.sort((a, b) => (a.c2rRtt ?? Infinity) - (b.c2rRtt ?? Infinity));'
  );
});

console.log('🎉 [PATCH-VOIP] Patching complete!');
