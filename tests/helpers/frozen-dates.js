import { isValidIsoDate } from '../../src/core/dates.js';

export {
  isValidIsoDate,
  monthLabel,
  monthName,
  monthOfIsoDate,
  shiftMonth
} from '../../src/core/dates.js';

let frusenDag = null;

export function todayIso() {
  if (frusenDag === null) {
    throw new Error(
      'frozen-dates: ingen dag är satt — laddaren ska sätta dagen innan src/web/app.js importeras.'
    );
  }
  return frusenDag;
}

export function setFrozenDay(day) {
  if (!isValidIsoDate(day)) {
    throw new Error(
      `frozen-dates kräver ett datum som finns i kalendern på formen ÅÅÅÅ-MM-DD, fick "${String(day)}".`
    );
  }
  frusenDag = day;
}

export function snapshotFrozenDay() {
  const tidigare = frusenDag;
  return () => {
    frusenDag = tidigare;
  };
}
