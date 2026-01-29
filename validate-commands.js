#!/usr/bin/env node
/**
 * Command Validation Script
 * Validates all command files without requiring Discord connection
 */

const fs = require('fs');
const path = require('path');

console.log('\n🔍 DisCryptoBank Command Validator');
console.log('='.repeat(50));

const commandsPath = path.join(__dirname, 'commands');
const commandFiles = fs.readdirSync(commandsPath).filter(file => file.endsWith('.js'));

console.log(`\n📂 Found ${commandFiles.length} command files\n`);

let validCount = 0;
let errorCount = 0;
const results = [];

for (const file of commandFiles) {
  try {
    const filePath = path.join(commandsPath, file);
    const command = require(filePath);
    
    // Validate command structure
    if (!command.data) {
      throw new Error('Missing "data" property');
    }
    if (!command.execute) {
      throw new Error('Missing "execute" function');
    }
    if (!command.data.name) {
      throw new Error('Command data missing "name" property');
    }
    if (!command.data.description) {
      throw new Error('Command data missing "description" property');
    }
    
    validCount++;
    results.push({
      file,
      name: command.data.name,
      description: command.data.description,
      status: '✅ VALID'
    });
    
    console.log(`✅ ${file}`);
    console.log(`   Command: /${command.data.name}`);
    console.log(`   Description: ${command.data.description}`);
    
  } catch (error) {
    errorCount++;
    results.push({
      file,
      status: `❌ ERROR: ${error.message}`
    });
    
    console.log(`❌ ${file}`);
    console.log(`   Error: ${error.message}`);
  }
}

console.log(`\n${'='.repeat(50)}`);
console.log(`📊 Validation Results`);
console.log(`${'='.repeat(50)}`);
console.log(`✅ Valid Commands: ${validCount}`);
console.log(`❌ Invalid Commands: ${errorCount}`);
console.log(`📦 Total: ${commandFiles.length}`);

if (errorCount === 0) {
  console.log(`\n🎉 All commands are valid!\n`);
  process.exit(0);
} else {
  console.log(`\n⚠️  ${errorCount} command(s) have errors\n`);
  process.exit(1);
}
