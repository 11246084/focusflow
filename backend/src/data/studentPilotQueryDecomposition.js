const STUDENT_PILOT_QUERY_DECOMPOSITION_PROFILE = 'phase3c-round3-v1';
const STUDENT_PILOT_Q11_G2_WORDING_PROFILE = 'phase3c-round4-q11-g2-v1';

const STUDENT_PILOT_QUERY_DECOMPOSITIONS = Object.freeze({
  Q08: Object.freeze([
    Object.freeze({
      id: 'Q08-S1-SEPARATE-DETECTORS',
      question: '找狗、找貓與找車時，是否需要在同一張影像上分別執行各自的偵測器？',
    }),
    Object.freeze({
      id: 'Q08-S2-REPEATED-COST',
      question: '為什麼目標種類愈多，對同一張影像重複執行多個物件偵測器會增加運算成本？',
    }),
  ]),
  Q11: Object.freeze([
    Object.freeze({
      id: 'Q11-S1-HARDWARE',
      question: 'OpenCV 與 YOLO 對 CPU、GPU 等硬體資源的需求有何差異？',
    }),
    Object.freeze({
      id: 'Q11-S2-MULTI-OBJECT',
      question: 'OpenCV 需要為狗、貓、車等不同物件分別執行偵測器，而 YOLO 如何在一次運算中偵測多種物件？',
    }),
  ]),
});

const STUDENT_PILOT_Q11_G2_QUERY_WORDINGS = Object.freeze([
  Object.freeze({
    id: 'Q11-ORIGINAL',
    question: 'OpenCV 與 YOLO 在硬體需求及多物件偵測方式上有何差異？',
  }),
  Object.freeze({
    id: 'Q11-G2-COMPARISON',
    question: 'OpenCV 需要為狗、貓、車等不同物件分別執行偵測器，而 YOLO 如何在一次運算中偵測多種物件？',
  }),
  Object.freeze({
    id: 'Q11-G2-YOLO-ONCE',
    question: 'YOLO 為什麼只需一次運算，就能同時找出貓、狗、車等多種物件？',
  }),
  Object.freeze({
    id: 'Q11-G2-THREE-VS-ONE',
    question: '分三次執行不同物件偵測器，與 YOLO 一次運算找出多種物件的方式有何差異？',
  }),
]);

module.exports = {
  STUDENT_PILOT_Q11_G2_QUERY_WORDINGS,
  STUDENT_PILOT_Q11_G2_WORDING_PROFILE,
  STUDENT_PILOT_QUERY_DECOMPOSITION_PROFILE,
  STUDENT_PILOT_QUERY_DECOMPOSITIONS,
};
