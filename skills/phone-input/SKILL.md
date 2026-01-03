# Phone Call Input Skill

## Description
Call the user on the phone for real-time voice conversations. Use this when you need input, want to report on completed work, or need to discuss next steps.

## When to Use This Skill

**Use when:**
- You've **completed a significant task** and want to report status and ask what's next
- You need **real-time voice input** for complex decisions
- A question requires **back-and-forth discussion** to fully understand
- You're **blocked** and need urgent clarification to proceed
- You want to **celebrate a milestone** or walk the user through completed work

**Do NOT use for:**
- Simple yes/no questions (use text)
- Routine status updates that don't need discussion
- Information the user has already provided

## Tools

### `initiate_call`
Start a phone call.

**Parameters:**
- `message` (string): What you want to say

**Returns:** Call ID and user's response

### `continue_call`
Continue with a follow-up.

**Parameters:**
- `call_id` (string): The call ID
- `message` (string): Your follow-up

**Returns:** User's response

### `end_call`
End the call.

**Parameters:**
- `call_id` (string): The call ID
- `message` (string): Your closing message

## Example: Status Report

```typescript
const { callId, response } = await initiate_call({
  message: "Hey! I finished implementing the authentication system. Want me to walk you through it, or should I move on to the next task?"
});

await end_call({
  call_id: callId,
  message: "Perfect! I'll start on the API endpoints next. Talk soon!"
});
```

## Best Practices

1. **Be conversational** - Talk naturally
2. **Provide context** - Explain what you've done
3. **Offer options** - Make it easy to decide
4. **End gracefully** - Always say goodbye with a clear next step
