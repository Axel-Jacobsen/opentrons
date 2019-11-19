// @flow
import {
  getNextRobotStateAndWarnings,
  getNextRobotStateAndWarningsMulti,
} from '../getNextRobotStateAndWarnings'
import {
  curryCommandCreator,
  reduceCommandCreatorsNext,
  commandCreatorsTimelineNext,
} from '../utils'
import type { InvariantContext } from '../types'

jest.mock('../getNextRobotStateAndWarnings')

let invariantContext

/** This is a minimalistic toy version of step-generation command creators and timeline updaters,
 * to show, at a glance, how all this works together.
 */
type CountState = {| count: number |}
type CountStateAndWarnings = {| robotState: CountState, warnings: Array<any> |}
type CountParams = {| value: number |}
type CountCommand = {|
  command: 'add' | 'multiply' | 'divide',
  params: { value: number },
|}
const addCreator: any = (
  params: CountParams,
  invariantContext: InvariantContext,
  prevState: CountState
) => ({
  commands: [{ command: 'add', params }],
  warnings: [],
})

const addCreatorWithWarning: any = (
  params: CountParams,
  invariantContext: InvariantContext,
  prevState: CountState
) => {
  const { value } = params
  // adds a warning for no meaningful reason
  const result = addCreator(params, invariantContext, prevState)
  return {
    ...result,
    warnings: [
      {
        type: 'ADD_WARNING',
        message: `adding ${value} with warning example`,
      },
    ],
  }
}

const multiplyCreator: any = (
  params: CountParams,
  invariantContext: InvariantContext,
  prevState: CountState
) => ({
  commands: [{ command: 'multiply', params }],
  warnings: [],
})

const divideCreator: any = (
  params: CountParams,
  invariantContext: InvariantContext,
  prevState: CountState
) => {
  const { value } = params
  if (value === 0) {
    return {
      errors: [
        {
          message: 'Cannot divide by zero',
          type: 'DIVIDE_BY_ZERO',
        },
      ],
    }
  }

  return {
    commands: [{ command: 'divide', params: { value } }],
    warnings: [],
  }
}

function mockNextRobotStateAndWarnings(
  command: CountCommand,
  invariantContext: any,
  prevState: CountState
): CountStateAndWarnings {
  const prevCount = prevState.count
  let count = null
  switch (command.command) {
    case 'add': {
      count = prevCount + command.params.value
      break
    }
    case 'multiply': {
      count = prevCount * command.params.value
      break
    }
    case 'divide': {
      count = prevCount / command.params.value
      break
    }
  }
  if (count === null) {
    throw new Error(
      `unknown command: ${command.command} passed to mockNextRobotStateAndWarning`
    )
  }
  const warnings = [] // NOTE: not making a fake implementation of any nextRobotState warnings!
  return { robotState: { count }, warnings }
}

function mockNextRobotStateAndWarningsMulti(
  commands: Array<CountCommand>,
  invariantContext: any,
  prevState: CountState
): CountStateAndWarnings {
  const nextState = commands.reduce(
    (acc, command) =>
      mockNextRobotStateAndWarnings(command, invariantContext, acc.robotState),
    { robotState: prevState, warnings: [] }
  )
  const warnings = [] // NOTE: not making a fake implementation of any nextRobotState warnings!
  return { robotState: nextState.robotState, warnings }
}

// $FlowFixMe: mock methods
getNextRobotStateAndWarnings.mockImplementation(mockNextRobotStateAndWarnings)
// $FlowFixMe: mock methods
getNextRobotStateAndWarningsMulti.mockImplementation(
  mockNextRobotStateAndWarningsMulti
)

beforeEach(() => {
  invariantContext = {
    labwareEntities: {},
    moduleEntities: {},
    pipetteEntities: {},
  }
})

describe('reduceCommandCreators', () => {
  test('basic command creators', () => {
    const initialState: any = { count: 0 }
    const result: any = reduceCommandCreatorsNext(
      [
        curryCommandCreator(addCreator, { value: 1 }),
        curryCommandCreator(multiplyCreator, { value: 2 }),
      ],
      invariantContext,
      initialState
    )

    expect(result).toEqual({
      commands: [
        { command: 'add', params: { value: 1 } },
        { command: 'multiply', params: { value: 2 } },
      ],
      warnings: [],
    })
  })

  test('error in a command short-circuits the command creation pipeline', () => {
    const initialState: any = { count: 5 }
    const result = reduceCommandCreatorsNext(
      [
        curryCommandCreator(addCreator, { value: 4 }),
        curryCommandCreator(divideCreator, { value: 0 }),
        curryCommandCreator(multiplyCreator, { value: 3 }),
      ],
      invariantContext,
      initialState
    )

    expect(result).toEqual({
      errors: [
        {
          message: 'Cannot divide by zero',
          type: 'DIVIDE_BY_ZERO',
        },
      ],
    })
  })

  test('warnings accumulate in a flat array across the command chain', () => {
    const initialState: any = { count: 5 }
    const result = reduceCommandCreatorsNext(
      [
        curryCommandCreator(addCreatorWithWarning, { value: 3 }),
        curryCommandCreator(multiplyCreator, { value: 2 }),
        curryCommandCreator(addCreatorWithWarning, { value: 1 }),
      ],
      invariantContext,
      initialState
    )

    expect(result).toEqual({
      commands: [
        { command: 'add', params: { value: 3 } },
        { command: 'multiply', params: { value: 2 } },
        { command: 'add', params: { value: 1 } },
      ],
      warnings: [
        { type: 'ADD_WARNING', message: 'adding 3 with warning example' },
        { type: 'ADD_WARNING', message: 'adding 1 with warning example' },
      ],
    })
  })
})

describe('commandCreatorsTimeline', () => {
  test('any errors short-circuit the timeline chain', () => {
    const initialState: any = { count: 5 }
    const result = commandCreatorsTimelineNext(
      [
        curryCommandCreator(addCreatorWithWarning, { value: 4 }),
        curryCommandCreator(divideCreator, { value: 0 }),
        curryCommandCreator(multiplyCreator, { value: 3 }),
      ],
      invariantContext,
      initialState
    )

    expect(result).toEqual({
      // error-creating "divide by zero" commands's index in the command creators array
      errors: [
        {
          message: 'Cannot divide by zero',
          type: 'DIVIDE_BY_ZERO',
        },
      ],

      timeline: [
        // add 4 step
        {
          robotState: { count: 5 + 4 },
          commands: [{ command: 'add', params: { value: 4 } }],
          // NOTE: IL 2019-11-19 command creator warnings do not appear in timeline
        },
        // no more steps in the timeline, stopped by error
      ],
    })
  })

  test('warnings are indexed in an indexed command chain', () => {
    const initialState: any = { count: 5 }
    const result = commandCreatorsTimelineNext(
      [
        curryCommandCreator(addCreatorWithWarning, { value: 3 }),
        curryCommandCreator(multiplyCreator, { value: 2 }),
        curryCommandCreator(addCreatorWithWarning, { value: 1 }),
      ],
      invariantContext,
      initialState
    )

    expect(result.timeline).toEqual([
      // add 3 w/ warning
      {
        robotState: { count: 8 },
        commands: [{ command: 'add', params: { value: 3 } }],
        // NOTE: IL 2019-11-19 command creator warnings do not appear in timeline
      },
      // multiply by 2
      {
        robotState: { count: 16 },
        commands: [{ command: 'multiply', params: { value: 2 } }],
        // no warnings -> no `warnings` key
      },
      // add 1 w/ warning
      {
        robotState: { count: 17 },
        commands: [{ command: 'add', params: { value: 1 } }],
        // NOTE: IL 2019-11-19 command creator warnings do not appear in timeline
      },
    ])
  })
})
