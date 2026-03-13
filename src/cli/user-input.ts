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
 * Prompt the user for alignment guidance when human intervention is required.
 * Shows the issues that triggered the intervention, then asks for direction.
 */
export async function promptHumanGuidance(
  issues: Array<{ description: string; severity: string }>
): Promise<string> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

  console.log('');
  console.log(chalk.yellow('⚠ Human alignment required'));
  console.log('');

  if (issues.length > 0) {
    console.log(chalk.white('  Issues flagged by the reviewer:'));
    for (const issue of issues) {
      const color = issue.severity === 'critical' ? chalk.red : chalk.yellow;
      console.log(`  ${color(`[${issue.severity}]`)} ${issue.description}`);
    }
    console.log('');
  }

  console.log(chalk.white('  What should the coder focus on? Provide context and direction:'));
  console.log('');

  return new Promise((resolve) => {
    rl.question(chalk.green('  Your guidance: '), (answer) => {
      rl.close();
      resolve(answer.trim());
    });
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
