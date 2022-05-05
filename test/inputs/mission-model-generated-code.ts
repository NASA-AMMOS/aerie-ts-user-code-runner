/** Start Codegen */
import type { ActivityTemplate } from './scheduler-edsl-fluent-api.js';

export enum ActivityType {
  // This indicates to the compiler that we are using a string enum so we can assign it to string for our AST
  PeelBanana = 'PeelBanana',
}

interface PeelBanana extends ActivityTemplate {}
export const ActivityTemplates = {
  PeelBanana: function PeelBanana(
    args: {
      duration: Duration,
      fancy: { subfield1: string, subfield2: { subsubfield1: Double, }[], },
      peelDirection: ('fromTip' | 'fromStem'),
    }): PeelBanana {
    return { activityType: ActivityType.PeelBanana, args };
  },
}

declare global {
  var ActivityTemplates: {
    PeelBanana: (
      args: {
        duration: Duration,
        fancy: { subfield1: string, subfield2: { subsubfield1: Double, }[], },
        peelDirection: ('fromTip' | 'fromStem'),
      }) => PeelBanana
  }
}
// Make ActivityTemplates available on the global object
Object.assign(globalThis, { ActivityTemplates });
/** End Codegen */
