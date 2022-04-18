import * as AST from './scheduler-ast.js';

const myDummyValue = AST.dummyValue;

interface ActivityRecurrenceGoal extends Goal {}
export class Goal {
  private readonly goalSpecifier: AST.GoalSpecifier;

  private constructor(goalSpecifier: AST.GoalSpecifier) {
    this.goalSpecifier = goalSpecifier;
  }

  private static new(goalSpecifier: AST.GoalSpecifier): Goal {
    return new Goal(goalSpecifier);
  }

  private __serialize(): AST.GoalSpecifier {
    return this.goalSpecifier;
  }

  public and(...others: Goal[]): Goal {
    return Goal.new({
      kind: 'GoalAnd',
      goals: [
        this.goalSpecifier,
        ...others.map(other => other.goalSpecifier),
      ],
    });
  }

  public or(...others: Goal[]): Goal {
    return Goal.new({
      kind: 'GoalOr',
      goals: [
        this.goalSpecifier,
        ...others.map(other => other.goalSpecifier),
      ],
    });
  }

  public static ActivityRecurrenceGoal(opts: { activityTemplate: ActivityTemplate, interval: Duration }): ActivityRecurrenceGoal {
    return Goal.new({
      kind: 'ActivityRecurrenceGoal',
      activityTemplate: opts.activityTemplate,
      interval: opts.interval,
    });
  }
}

declare global {
  export class Goal {
    public and(...others: Goal[]): Goal

    public or(...others: Goal[]): Goal

    public static ActivityRecurrenceGoal(opts: { activityTemplate: ActivityTemplate, interval: Duration }): ActivityRecurrenceGoal
  }
  type Duration = number;
  type Double = number;
  type Integer = number;
}

export interface ActivityTemplate extends AST.ActivityTemplate {}

// Make Goal available on the global object
Object.assign(globalThis, { Goal });
