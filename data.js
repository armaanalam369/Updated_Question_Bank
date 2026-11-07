window.QUESTION_BANK = [];

// Add the relative paths of all your JSON files here:
const DATASET_FILES = [
  './geography_questions.json',
  './history_questions.json',
  './science_questions.json'
];

/**
 * Loads all registered JSON files asynchronously and aggregates them
 * into window.QUESTION_BANK.
 */
window.loadQuestionBank = async function () {
  try {
    const fetchPromises = DATASET_FILES.map(async (fileUrl) => {
      try {
        const response = await fetch(fileUrl);
        if (!response.ok) {
          // If a file is not yet uploaded, warn and continue with others
          console.warn(`File ${fileUrl} returned status ${response.status}. Skipping.`);
          return [];
        }
        const data = await response.json();
        return Array.isArray(data) ? data : [];
      } catch (err) {
        console.warn(`Failed to fetch or parse ${fileUrl}:`, err);
        return [];
      }
    });

    const results = await Promise.all(fetchPromises);
    window.QUESTION_BANK = results.flat();
    console.log(`Successfully loaded ${window.QUESTION_BANK.length} total questions across datasets.`);
    return window.QUESTION_BANK;
  } catch (error) {
    console.error('Critical failure loading question bank datasets:', error);
    window.QUESTION_BANK = [];
    return [];
  }
};
