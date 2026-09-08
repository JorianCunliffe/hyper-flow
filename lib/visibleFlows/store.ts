import {
  readVisibleFlow,
  transactVisibleFlow,
  listVisibleFlows,
} from "../serverStore.js";
export const flowStore = {
  read: readVisibleFlow,
  transact: transactVisibleFlow,
  list: listVisibleFlows,
};
export type FlowStore = typeof flowStore;
