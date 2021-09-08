import {
  configureStore,
  createSlice,
  createSelector,
  PayloadAction,
} from "@reduxjs/toolkit";
import { takeEvery, call, put } from "redux-saga/effects";
import createSagaMiddleware from "redux-saga";
import { toComputedLedger } from "@fifo/ledger";
import { TypedUseSelectorHook, useDispatch, useSelector } from "react-redux";
import { applyLedgerItem, AppStateItem } from "./app-state";
import { coinbaseApi, getPriceAt } from "./coinbase";
import { readCsv } from "@fifo/csv-reader";

const sagaMiddleware = createSagaMiddleware();

const DEFEAULT_EVENTS: AppStateItem[] = [];
const eventsSlice = createSlice({
  initialState: DEFEAULT_EVENTS,
  name: "events",
  reducers: {
    insert: (state, action: PayloadAction<AppStateItem>) => {
      state.push(action.payload);
    },
  },
});

const { insert: _insertEvent } = eventsSlice.actions;

export const store = configureStore({
  reducer: {
    events: eventsSlice.reducer,
    [coinbaseApi.reducerPath]: coinbaseApi.reducer,
  },
  middleware: (getDefaultMiddleware) => [
    ...getDefaultMiddleware(),
    sagaMiddleware,
    coinbaseApi.middleware,
  ],
});
export type RootState = ReturnType<typeof store.getState>;
export type AppDispatch = typeof store.dispatch;

export const useAppDispatch = () => useDispatch<AppDispatch>();
export const useAppSelector: TypedUseSelectorHook<RootState> = useSelector;
const typedSelector = <T>(selector: (state: RootState) => T) => selector;

export const eventsSelector = typedSelector((state) => state.events);
export const ledgerSelector = createSelector(eventsSelector, (events) =>
  events.reduce(applyLedgerItem, [])
);
export const computedLedgerSelector = createSelector(ledgerSelector, (ledger) =>
  toComputedLedger(ledger)
);

function* autoFillCoinUnitPrices(action: PayloadAction<AppStateItem>) {
  const event = action.payload;
  if (event.type !== "importCoinbaseCsv" || event.prefilledEurValues) {
    yield put(_insertEvent(event));
    return;
  }

  const ledgerItems = readCsv(event.data);
  const prefilledEurValues = {};
  for (const ledgerItem of ledgerItems) {
    try {
      const filledFrom = yield call(
        getPriceAt,
        ledgerItem.date,
        ledgerItem.from.symbol
      );
      prefilledEurValues[
        `${ledgerItem.from.symbol}-${ledgerItem.date.toString({
          calendarName: "never",
        })}`
      ] = filledFrom;
    } catch (e) {
      try {
        const filledTo = yield call(
          getPriceAt,
          ledgerItem.date,
          ledgerItem.from.symbol
        );
        prefilledEurValues[
          `${ledgerItem.to.symbol}-${ledgerItem.date.toString({
            calendarName: "never",
          })}`
        ] = filledTo;
      } catch (e) {}
    }
  }

  yield put(_insertEvent({ ...event, prefilledEurValues }));
}

const INSERT_WITH_AUTOFILL_ACTION = "events/insert-with-autofill";
function* appSagas() {
  yield takeEvery(INSERT_WITH_AUTOFILL_ACTION, autoFillCoinUnitPrices);
}

export const insertEvent = (
  payload: AppStateItem
): PayloadAction<AppStateItem> => ({
  type: INSERT_WITH_AUTOFILL_ACTION,
  payload,
});

sagaMiddleware.run(appSagas);
