const STUDENT_PILOT_RETRIEVAL_GROUND_TRUTH_SCHEMA = 'student-pilot-retrieval-ground-truth-v1';
const STUDENT_PILOT_RETRIEVAL_GROUND_TRUTH_SOURCE = 'docs/2026-09_Student_Pilot_Backend/evidence/2026-09-01_baseline_questions.md';

function chunkIds(videoId, start, end) {
  return Array.from(
    { length: end - start + 1 },
    (_, offset) => `${videoId}_chunk_${String(start + offset).padStart(4, '0')}`,
  );
}

function group(groupId, videoId, start, end) {
  return Object.freeze({
    groupId,
    videoId,
    chunkIds: Object.freeze(chunkIds(videoId, start, end)),
  });
}

function entry(...expectedLeafGroups) {
  return Object.freeze({ expectedLeafGroups: Object.freeze(expectedLeafGroups) });
}

// Derived from the human-reviewed support ranges in the source Markdown above.
// Keep groups separate when the question requires evidence from more than one range.
const STUDENT_PILOT_RETRIEVAL_GROUND_TRUTH = Object.freeze({
  Q01: entry(group('G1', '69fb57edb52433fda32db706', 6, 7)),
  Q02: entry(group('G1', '69fb5b5eb52433fda32db907', 1, 2)),
  Q03: entry(group('G1', '69fb5c8db52433fda32dbab5', 2, 4)),
  Q04: entry(group('G1', '6a02f34d17c615e872035b3d', 6, 7)),
  Q05: entry(group('G1', '69fb5d78b52433fda32dbc81', 5, 8)),
  Q06: entry(group('G1', '6a02f38c17c615e872035b94', 2, 6)),
  Q07: entry(group('G1', '6a02f34d17c615e872035b3d', 3, 5)),
  Q08: entry(group('G1', '6a02f46317c615e872035c93', 2, 6)),
  Q09: entry(
    group('G1', '69fb5c8db52433fda32dbab5', 5, 8),
    group('G2', '69fb5d78b52433fda32dbc81', 1, 4),
  ),
  Q10: entry(group('G1', '69fb5b5eb52433fda32db907', 1, 5)),
  Q11: entry(
    group('G1', '6a02f38c17c615e872035b94', 2, 6),
    group('G2', '6a02f48c17c615e872035cea', 1, 7),
  ),
  Q12: entry(
    group('G1', '6a02f48c17c615e872035cea', 1, 7),
    group('G2', '6a02f4b017c615e872035d41', 1, 12),
  ),
});

module.exports = {
  STUDENT_PILOT_RETRIEVAL_GROUND_TRUTH,
  STUDENT_PILOT_RETRIEVAL_GROUND_TRUTH_SCHEMA,
  STUDENT_PILOT_RETRIEVAL_GROUND_TRUTH_SOURCE,
};
