#!/usr/bin/env node
// Headless Playwright driver: reads newline-delimited commands from stdin,
// executes each against a single shared page, prints one result line per
// command. App-agnostic except for the default URL — copy into a project's
// .claude/skills/smoke-test/ and adapt selectors/scenarios per app.
//
// Commands:
//   nav <url>              navigate
//   click <selector>       click element
//   fill <selector> <text> fill input (clears first)
//   type <selector> <text> type into input (no clear, simulates keystrokes)
//   press <key>            press a key on the focused element
//   wait <ms>              wait a fixed duration
//   wait-text <text>       wait until text appears in the page body
//   eval <js>              evaluate JS in page context, print the result
//   screenshot <name>      save screenshot to ./screenshots/<name>.png
//   title                  print document title
//   url                    print current URL
//   errors                 print accumulated console/page errors since start
//   quit                   close browser, exit (non-zero if errors occurred)
//
// Usage: node driver.mjs < scenarios/some-scenario.txt

import { chromium } from 'playwright';
import readline from 'node:readline';
import fs from 'node:fs';
import path from 'node:path';

const SCREENSHOT_DIR = 'screenshots';
const errors = [];

async function main() {
  const browser = await chromium.launch();
  const page = await browser.newPage();

  page.on('pageerror', (err) => errors.push(`pageerror: ${err.message}`));
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(`console: ${msg.text()}`);
  });

  const rl = readline.createInterface({ input: process.stdin, terminal: false });

  for await (const rawLine of rl) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;

    const [cmd, ...rest] = line.split(' ');
    const arg = rest.join(' ');

    try {
      switch (cmd) {
        case 'nav':
          await page.goto(arg, { waitUntil: 'load' });
          break;
        case 'click':
          await page.click(arg);
          break;
        case 'fill': {
          const [selector, ...textParts] = rest;
          await page.fill(selector, textParts.join(' '));
          break;
        }
        case 'type': {
          const [selector, ...textParts] = rest;
          await page.type(selector, textParts.join(' '));
          break;
        }
        case 'press':
          await page.keyboard.press(arg);
          break;
        case 'wait':
          await page.waitForTimeout(Number(arg));
          break;
        case 'wait-text':
          await page.waitForFunction(
            (text) => document.body.innerText.includes(text),
            arg,
            { timeout: 10000 },
          );
          break;
        case 'eval': {
          const result = await page.evaluate(arg);
          console.log(`OK eval => ${JSON.stringify(result)}`);
          continue;
        }
        case 'screenshot': {
          fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
          const file = path.join(SCREENSHOT_DIR, `${arg}.png`);
          await page.screenshot({ path: file, fullPage: true });
          console.log(`OK screenshot => ${file}`);
          continue;
        }
        case 'title':
          console.log(`OK title => ${await page.title()}`);
          continue;
        case 'url':
          console.log(`OK url => ${page.url()}`);
          continue;
        case 'errors':
          if (errors.length === 0) {
            console.log('OK errors => none');
          } else {
            console.log(`ERR errors => ${errors.length} error(s):`);
            errors.forEach((e) => console.log(`  ${e}`));
          }
          continue;
        case 'quit':
          await browser.close();
          process.exit(errors.length > 0 ? 1 : 0);
          break;
        default:
          console.log(`ERR unknown command: ${cmd}`);
          continue;
      }
      console.log(`OK ${line}`);
    } catch (err) {
      console.log(`ERR ${line}: ${err.message}`);
    }
  }

  await browser.close();
}

main();
