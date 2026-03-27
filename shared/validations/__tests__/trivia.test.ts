import test from 'node:test';
import assert from 'node:assert';
import { triviaQuestionResponseSchema } from '../trivia';

test('trivia validations', async (t) => {
  await t.test('triviaQuestionResponseSchema requires exactly 4 options', () => {
    // Valid response
    const valid = {
      question: 'What is the song name?',
      options: ['A', 'B', 'C', 'D'],
      correctIndex: 2
    };
    assert.doesNotThrow(() => triviaQuestionResponseSchema.parse(valid));

    // Invalid: less than 4 options
    const tooFew = {
      question: 'What is the song name?',
      options: ['A', 'B', 'C'],
      correctIndex: 0
    };
    assert.throws(() => triviaQuestionResponseSchema.parse(tooFew));

    // Invalid: more than 4 options
    const tooMany = {
      question: 'What is the song name?',
      options: ['A', 'B', 'C', 'D', 'E'],
      correctIndex: 3
    };
    assert.throws(() => triviaQuestionResponseSchema.parse(tooMany));
  });

  await t.test('triviaQuestionResponseSchema requires correctIndex between 0 and 3', () => {
    const createWithIndex = (index: number) => ({
      question: 'What is the song name?',
      options: ['A', 'B', 'C', 'D'],
      correctIndex: index
    });

    // Valid bounds
    assert.doesNotThrow(() => triviaQuestionResponseSchema.parse(createWithIndex(0)));
    assert.doesNotThrow(() => triviaQuestionResponseSchema.parse(createWithIndex(3)));

    // Invalid bounds
    assert.throws(() => triviaQuestionResponseSchema.parse(createWithIndex(-1)));
    assert.throws(() => triviaQuestionResponseSchema.parse(createWithIndex(4)));
  });
});
