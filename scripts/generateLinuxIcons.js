#!/usr/bin/env node
/**
 * Script para gerar ícones Linux em múltiplos tamanhos
 * Requer: npm install sharp (ou use ferramentas online)
 * 
 * Uso: node scripts/generateLinuxIcons.js
 * 
 * Se não tiver sharp instalado, use uma ferramenta online como:
 * - https://www.iloveimg.com/resize-image
 * - https://www.resizepixel.com/
 * 
 * Crie ícones QUADRADOS nos tamanhos:
 * - 16x16, 32x32, 48x48, 64x64, 128x128, 256x256, 512x512
 * 
 * Salve em: build/icons/16x16.png, build/icons/32x32.png, etc.
 */

const fs = require('fs');
const path = require('path');

const sizes = [16, 32, 48, 64, 128, 256, 512];
const inputIcon = path.join(__dirname, '../build/icon.png');
const outputDir = path.join(__dirname, '../build/icons');

// Tenta usar sharp se disponível
async function generateIcons() {
  try {
    const sharp = require('sharp');
    
    // Garante que a pasta existe
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }
    
    console.log('🎨 Gerando ícones Linux...\n');
    
    for (const size of sizes) {
      const outputFile = path.join(outputDir, `${size}x${size}.png`);
      
      await sharp(inputIcon)
        .resize(size, size, {
          fit: 'contain',
          background: { r: 0, g: 0, b: 0, alpha: 0 }
        })
        .png()
        .toFile(outputFile);
      
      console.log(`✅ ${size}x${size}.png`);
    }
    
    console.log('\n🎉 Ícones gerados com sucesso em build/icons/');
    
  } catch (error) {
    if (error.code === 'MODULE_NOT_FOUND') {
      console.log('⚠️  Sharp não está instalado.\n');
      console.log('Para gerar os ícones automaticamente, instale sharp:');
      console.log('  npm install sharp --save-dev\n');
      console.log('Ou crie os ícones manualmente:');
      console.log('  1. Use https://www.iloveimg.com/resize-image');
      console.log('  2. Faça upload de build/icon.png');
      console.log('  3. Redimensione para 512x512 (quadrado)');
      console.log('  4. Salve como build/icons/512x512.png');
      console.log('  5. Repita para: 256x256, 128x128, 64x64, 48x48, 32x32, 16x16\n');
    } else {
      console.error('Erro:', error.message);
    }
  }
}

generateIcons();
