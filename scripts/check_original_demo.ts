import { demoSessions } from '../src/study/demoData';
import { computeStats, emptyData, addJSON } from '../src/study/analysis';

const data = emptyData();
demoSessions().forEach(s => addJSON(data, s));
const stats = computeStats(data);
console.log('Original demoData stats:');
stats.measures.forEach(m => console.log(m.label, ': Baseline =', m.medBaseline, 'WYSIWYC =', m.medWysiwyc, 'Change =', (m.change * 100).toFixed(1) + '%'));
