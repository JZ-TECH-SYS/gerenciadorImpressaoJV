#!/usr/bin/env node
/**
 * Incrementa automaticamente a versão patch em package.json.
 * Mantém major/minor e soma +1 no patch.
 * Ex: 2.0.5 -> 2.0.6
 */
const fs = require('fs');
const path = require('path');

const pkgPath = path.join(__dirname, '..', 'package.json');
const pkgRaw = fs.readFileSync(pkgPath, 'utf-8');
const pkg = JSON.parse(pkgRaw);

function bumpPatch(version) {
  const parts = version.split('.').map(Number);
  if (parts.length !== 3 || parts.some(isNaN)) {
    throw new Error('Versão inválida em package.json');
  }
  parts[2] += 1; // patch++
  return parts.join('.');
}

const oldVersion = pkg.version;
const newVersion = bumpPatch(oldVersion);

pkg.version = newVersion;
fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n');

console.log(`Versão: ${oldVersion} -> ${newVersion}`);
