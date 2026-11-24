// Anonymous start-of-lesson survey: questions, the saved record, and the class charts.
// Pure module (no DOM, no Firebase), shared by student.js, teacher.js, results.js and verify.mjs.
// Keep the question IDs and answer IDs identical to validSurveyResult() in firestore.rules.
import { SCHEMA_VERSION } from './result-records.js';

export const SURVEY_QUESTIONS = [
  {
    id: 'coding', short: 'Coding experience',
    text: 'Have you written code before?',
    options: [['never', 'Never'], ['little', 'A little: Scratch, a tutorial or a class'], ['regular', 'Yes, I write code regularly']],
  },
  {
    id: 'aiUse', short: 'Using AI tools',
    text: 'How often do you use AI tools such as ChatGPT?',
    options: [['never', 'Never'], ['sometimes', 'Sometimes'], ['weekly', 'Every week'], ['daily', 'Almost every day']],
  },
  {
    id: 'goal', short: 'What they want from the course',
    text: 'What do you most want from this course?',
    options: [['understand', 'Understand how AI really works'], ['build', 'Build my own AI projects'], ['compete', 'Prepare for competitions such as IOAI'], ['unsure', 'Not sure yet']],
  },
  {
    id: 'learning', short: 'How AI learns',
    text: 'How do you think an AI system learns to recognize a dog?',
    options: [['rules', 'Programmers write rules for it'], ['examples', 'It finds patterns in many labeled examples'], ['understands', 'It understands pictures like a person does'], ['unsure', 'Not sure']],
  },
];
export const SURVEY_FIELDS = ['kind', 'schemaVersion', 'studentId', 'sessionId', ...SURVEY_QUESTIONS.map((q) => q.id), 'createdAt'];

// The fields a student sends. studentId, sessionId and createdAt are added at write time.
export function surveyResult(answers) {
  const result = { kind: 'survey', schemaVersion: SCHEMA_VERSION };
  for (const question of SURVEY_QUESTIONS) {
    const answer = answers?.[question.id];
    if (!question.options.some(([id]) => id === answer)) throw new Error('Survey answer does not match the saved-result schema.');
    result[question.id] = answer;
  }
  return result;
}

// One answer set per student: if a student sent the survey twice, only the latest counts.
export function tallySurvey(records) {
  const time = (record) => record.createdAt?.toMillis?.() ?? (Number(record.createdAt) || 0);
  const latest = new Map();
  for (const record of [...records].filter((r) => r.kind === 'survey').sort((a, b) => time(a) - time(b))) latest.set(record.studentId, record);
  const answers = [...latest.values()];
  return {
    total: answers.length,
    questions: SURVEY_QUESTIONS.map((question) => ({
      ...question,
      counts: question.options.map(([id, label]) => ({ id, label, count: answers.filter((a) => a[question.id] === id).length })),
    })),
  };
}

const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));

// A horizontal bar chart for one question. Bars are scaled to the number of respondents.
export function surveyChartHtml(question, total) {
  const rows = question.counts.map(({ label, count }) => {
    const share = total ? Math.round(100 * count / total) : 0;
    return '<li><span class="survey-label">' + esc(label) + '</span><span class="survey-bar" aria-hidden="true"><i style="width:' + share + '%"></i></span><b>' + count + '</b></li>';
  }).join('');
  return '<figure class="survey-chart"><figcaption>' + esc(question.text) + '</figcaption><ol>' + rows + '</ol></figure>';
}
