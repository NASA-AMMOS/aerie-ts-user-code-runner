/** Start Codegen */
interface PeelBanana extends ActivityTemplate {}
export const ActivityTemplates = {
  PeelBanana: function PeelBanana(
    args: {
      peelDirection: ("fromTip" | "fromStem")
    }): PeelBanana {
      return { activityType: 'PeelBanana', args };
    },
}
declare global {
  var ActivityTemplates: {
    PeelBanana: (
      args: {
        peelDirection: ("fromTip" | "fromStem")
      }) => PeelBanana
  }
}

Object.assign(globalThis, { ActivityTemplates });
/** End Codegen */