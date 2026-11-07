window.QUESTION_BANK = [];

// Asynchronously load the complete 366 Geography question bank
window.loadQuestionBank = async function () {
  try {
    const response = await fetch('./geography_questions.json');
    if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
    const data = await response.json();
    window.QUESTION_BANK = data;
    return data;
  } catch (error) {
    console.error('Failed to load geography question bank:', error);
    return [];
  }
};
