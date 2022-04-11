/** Start Codegen */
import type { ActivityTemplate } from './scheduler-edsl-fluent-api.js';
interface PeelBanana extends ActivityTemplate {}
export const ActivityTemplates = {
	PeelBanana: function PeelBanana(
		args: {
			duration: Duration,
			fancy: { subfield1: string, subfield2: { subsubfield1: Double, }[], }
			peelDirection: ("fromTip" | "fromStem")
		}): PeelBanana {
		return { activityType: 'PeelBanana', args };
	},
}
declare global {
	var ActivityTemplates: {
		PeelBanana: (
			args: {
				duration: Duration,
				fancy: { subfield1: string, subfield2: { subsubfield1: Double, }[], },
				peelDirection: ("fromTip" | "fromStem")
			}) => PeelBanana
	}
}
// Make ActivityTemplates available on the global object
Object.assign(globalThis, { ActivityTemplates });
/** End Codegen */