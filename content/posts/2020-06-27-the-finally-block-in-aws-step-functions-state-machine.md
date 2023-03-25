---
title: "The “finally” block in AWS Step Functions state machine"
date: 2020-06-07T00:00:00
draft: false
---

![](https://miro.medium.com/v2/resize:fit:1400/format:webp/1*-_h7CEaXJcAIbALDtPrqYQ.jpeg)

*Originally posted on [Medium](https://medium.com/swlh/the-finally-block-in-aws-step-functions-state-machine-40048faaeffe).*

## Problem Statement

If you’re not familiar with [AWS Step Functions](https://docs.aws.amazon.com/step-functions/latest/dg/welcome.html), it is a service where we can create state-machines to orchestrate asynchronous tasks in workflows without worrying too much about any underlying infrastructure and operations. I’ve been using it a lot recently, and I’d like to share the way I implement a `finally` block in a Step Functions state machine.

In a workflow, there could be some operations that need to be executed no matter what happens, for example, cleaning up temporary resources that are created at the beginning of the workflow. If we relate to Java language, it is similar to what we do with `finally` block.

```
try {
  // Do something
} catch (SomeException ex) {
  // Handle exception
} finally { 
  // The things that must happen no matter what
}
```

In AWS Step Functions, the default behavior when a state reports an exception is to fail the execution entirely, which means the rest of the state in the state machine will not be executed. Step Functions provides the feature to catch exceptions (please refer to [Error Handling in Step Functions](https://docs.aws.amazon.com/step-functions/latest/dg/concepts-error-handling.html)), but there is no explicit feature for the `finally` block.

## Solution
I figured that we could use `Catch` field with the wildcard exception name `States.ALL` to implement the `finally` block. Let’s start with a simple example:

```json
{
  "Comment": "An simple example",
  "StartAt": "DoSomething",
  "States": {
    "DoSomething": {
      "Type": "Task",
      "Resource": "arn:aws:states:${region}:${account}:activity:DoSomethingActivity",
      "Next": "Cleanup"
    },
    "Cleanup": {
      "Type": "Task",
      "Resource": "arn:aws:states:${region}:${account}:activity:CleanupActivity",
      "End": true
    }
  }
}
```

This is a state machine that has only one step then clean up, and we don’t have any error handling in it yet.

![](https://miro.medium.com/v2/resize:fit:264/format:webp/1*Kbjok3I9Aiv88v-MoETqZw.png)

If the state `DoSomething` gets any exception, either thrown from inside the activity or thrown by Step Functions due to timeout, etc., the state `Cleanup` will not be executed. 

### Simple Case
Now, let’s implement our `finally`:

```json
{
  "Comment": "An simple example with Catch",
  "StartAt": "DoSomething",
  "States": {
    "DoSomething": {
      "Type": "Task",
      "Resource": "arn:aws:states:${region}:${account}:activity:DoSomethingActivity",
      "Catch": [
        {
          "ErrorEquals": [
            "States.ALL"
          ],
          "ResultPath": null,
          "Next": "Cleanup"
        }
      ],
      "Next": "Cleanup"
    },
    "Cleanup": {
      "Type": "Task",
      "Resource": "arn:aws:states:${region}:${account}:activity:CleanupActivity",
      "End": true
    }
  }
}
```

I added the `Catch` field in the state of `DoSomething`. It uses the wildcard `States.ALL` to catch almost all exceptions and make `Cleanup` to be the fallback state. In this way, `Cleanup` will be executed no matter if `DoSomething` succeeds or fails.

Note that the “catcher”, as called so by AWS documentation, has a `ResultPath` field, this is because the output of an exception will be its diagnose data and it usually should not overwrite the payload of the state machine. You can use `"ResultPath": null"` to ignore the exception output, or, use something like `"ResultPath": "$.exception"` to put the exception output in a certain JSON field of the payload.

Not too bad, right? But what if the workflow has 10, or even 100 states?

### How about a complex state machine?

Yes, the example above is oversimplified, it is very usual that a state machine has multiple states. One straightforward way could be to add the same catcher in every single state of the state machine, but that will be too much of repeating. I’d like to share two options that I found more elegant than that. But I need to point out that, according to the syntax of Amazon States Language (the JSON language to describe a state machine), only `Task`, `Parallel`, and `Map` state can have `Catch` filed. I hope you find the following options make sense considering this restriction.

#### Option 1: Wrap the workflow body within a `Parallel` state which has only one branch

```json
{
  "Comment": "An simple example using Parallel",
  "StartAt": "Prepare",
  "States": {
    "Prepare": {
      "Type": "Task",
      "Resource": "arn:aws:states:${region}:${account}:activity:PrepareActivity",
      "Next": "WorkflowBody"
    },
    "WorkflowBody": {
      "Type": "Parallel",
      "Branches": [
        {
          "StartAt": "DoSomething",
          "States": {
            "DoSomething": {
              "Type": "Task",
              "Resource": "arn:aws:states:${region}:${account}:activity:DoSomethingActivity",
              "Next": "DoSomethingElse"
            },
            "DoSomethingElse": {
              "Type": "Task",
              "Resource": "arn:aws:states:${region}:${account}:activity:DoSomethingElseActivity",
              "End": true
            }
          }
        }
      ],
      "Catch": [
        {
          "ErrorEquals": [
            "States.ALL"
          ],
          "ResultPath": null,
          "Next": "Cleanup"
        }
      ],
      "Next": "Cleanup"
    },
    "Cleanup": {
      "Type": "Task",
      "Resource": "arn:aws:states:${region}:${account}:activity:CleanupActivity",
      "End": true
    }
  }
}
```

In this option, the state machine has three states: `Prepare`, `WorkflowBody`, and `Cleanup`. `WorkflowBody` encapsulates the main steps of the workflow, and it has the catcher associated. Therefore, if the steps `DoSomething` and `DoSomethingElse` throw any exception, it will be caught by the `Catch` field of `WorkflowBody` and `Cleanup` will be executed anyway.

![](https://miro.medium.com/v2/resize:fit:394/format:webp/1*ZG68uoN7qfxj6wP92sdIvg.png)

#### Option 2: Create a separate state machine for the workflow body and execute it from the one has the catcher

```json
{
  "Comment": "An simple example with invoking another state machine",
  "StartAt": "Prepare",
  "States": {
    "Prepare": {
      "Type": "Task",
      "Resource": "arn:aws:states:${region}:${account}:activity:PrepareActivity",
      "Next": "WorkflowBody"
    },
    "WorkflowBody": {
      "Type": "Task",
      "Resource": "arn:aws:states:::states:startExecution.sync",
      "Parameters": {
        "StateMachineArn": "arn:aws:states:${region}:${account}:stateMachine:WorkflowBody",
        "Input": {
          "AWS_STEP_FUNCTIONS_STARTED_BY_EXECUTION_ID.$": "$$.Execution.Id",
          "yourData.$": "$.fromPayload"
        }
      },
      "Catch": [
        {
          "ErrorEquals": [
            "States.ALL"
          ],
          "ResultPath": null,
          "Next": "Cleanup"
        }
      ],
      "Next": "Cleanup"
    },
    "Cleanup": {
      "Type": "Task",
      "Resource": "arn:aws:states:${region}:${account}:activity:CleanupActivity",
      "End": true
    }
  }
}
```

In this option, there will be two state machines defined for one workflow. The first one, which is the code above, defines the prepare and cleanup states and uses `arn:aws:state:::states:startExecution.sync` to invoke the second state machine. And the second state machine will contain the main steps of the workflow.

#### Consideration of two options

These two options work well, but I’d personally prefer Option 1. The main cons of Option 2 are: (1) it will consume more quota of the API `StartExecution`, therefore, higher risk of getting throttled; (2) There are more pieces of infrastructure in our stack, including multiple state machines, the IAM policy for a state machine invoking another (please refer to [IAM policies](https://docs.aws.amazon.com/step-functions/latest/dg/stepfunctions-iam.html)), etc.

One more thing to take into consideration is that the wildcard `States.ALL` is not a superset of all exceptions, so the way I showed in this article is not technically a real `finally`. As the documentation said, `States.Runtime` errors will not be caught with a `Retry` or `Catch` statement of `States.ALL`. But fortunately, `States.Runtime` is usually caused by the incorrectly defined input/output in the state machine. I hope that kind of problem should be captured by your tests, rather than during the runtime.

## Conclusion

In a state machine defined in AWS Step Functions, we can use `Catch` field with `States.ALL` wildcard to execute the steps that need to happen no matter what, for example, cleaning up resources.

When there are multiple states in the state machine, one possible way is to encapsulate the main workflow body in a `Parallel` state with the catcher associated. An alternative is to create a separate workflow and invoke one from another, which has some downsides.

It’s also important to notice that `States.ALL` does not catch all exceptions like `States.Runtime`. Testing the state machine is very necessary.
