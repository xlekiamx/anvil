import * as readline from 'readline';
import chalk from 'chalk';
import type { DetectedQuestion } from '../agents/types.js';

/**
 * Display a question from Claude and collect user input
 */
export async function promptUserForAnswer(question: DetectedQuestion): Promise<string> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise((resolve) => {
    console.log('');
    console.log(chalk.yellow('⚠ Claude needs clarification:'));
    console.log('');
    console.log(chalk.white(`  ${question.question}`));
    console.log('');

    // If options are provided, display them numbered
    if (question.options && question.options.length > 0) {
      question.options.forEach((opt, index) => {
        const label = chalk.cyan(`[${index + 1}]`);
        const desc = opt.description ? chalk.gray(` - ${opt.description}`) : '';
        console.log(`  ${label} ${opt.label}${desc}`);
      });
      console.log(`  ${chalk.cyan(`[${question.options.length + 1}]`)} Other - Provide custom answer`);
      console.log('');

      rl.question(chalk.green('  Your choice: '), (answer) => {
        rl.close();

        const trimmed = answer.trim();
        const num = parseInt(trimmed, 10);

        // Check if user selected a numbered option
        if (!isNaN(num) && num >= 1 && num <= question.options!.length) {
          const selected = question.options![num - 1]!;
          console.log('');
          console.log(chalk.gray(`  Selected: ${selected.label}`));
          resolve(selected.label);
        } else if (!isNaN(num) && num === question.options!.length + 1) {
          // User wants to provide custom answer
          const rl2 = readline.createInterface({
            input: process.stdin,
            output: process.stdout,
          });
          rl2.question(chalk.green('  Your answer: '), (customAnswer) => {
            rl2.close();
            resolve(customAnswer.trim());
          });
        } else {
          // Treat as free-text answer
          resolve(trimmed);
        }
      });
    } else {
      // No options, just free-text input
      rl.question(chalk.green('  Your answer: '), (answer) => {
        rl.close();
        resolve(answer.trim());
      });
    }
  });
}

/**
 * Display a pending question that was saved from a previous session
 */
export function displayPendingQuestion(question: {
  question: string;
  options?: Array<{ label: string; description?: string }>;
  asked_at: string;
}): void {
  console.log('');
  console.log(chalk.yellow('⚠ Pending question from previous session:'));
  console.log(chalk.gray(`  Asked at: ${new Date(question.asked_at).toLocaleString()}`));
  console.log('');
  console.log(chalk.white(`  ${question.question}`));
  console.log('');

  if (question.options && question.options.length > 0) {
    question.options.forEach((opt, index) => {
      const label = chalk.cyan(`[${index + 1}]`);
      const desc = opt.description ? chalk.gray(` - ${opt.description}`) : '';
      console.log(`  ${label} ${opt.label}${desc}`);
    });
    console.log(`  ${chalk.cyan(`[${question.options.length + 1}]`)} Other - Provide custom answer`);
    console.log('');
  }
}
