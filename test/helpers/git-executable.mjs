const GIT_EXECUTABLE = String(process.env.REL_AI_TEST_GIT || 'git').trim() || 'git';

export { GIT_EXECUTABLE };
