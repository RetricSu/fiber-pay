# browser-wallet

## 0.0.11

### Patch Changes

- Updated dependencies [615e3bf]
  - @fiber-pay/sdk@0.3.1

## 0.0.10

### Patch Changes

- @fiber-pay/sdk@0.3.0

## 0.0.9

### Patch Changes

- Updated dependencies [42724a3]
- Updated dependencies [2aa9402]
- Updated dependencies [42724a3]
- Updated dependencies [ca02a01]
  - @fiber-pay/sdk@0.2.8

## 0.0.8

### Patch Changes

- Updated dependencies [ec536f4]
  - @fiber-pay/sdk@0.2.7

## 0.0.7

### Patch Changes

- Updated dependencies [7bc83aa]
- Updated dependencies [b0610f7]
- Updated dependencies [06cfef0]
  - @fiber-pay/sdk@0.2.6

## 0.0.6

### Patch Changes

- Updated dependencies [4116af6]
- Updated dependencies [eb4b9c3]
- Updated dependencies [a0e3c78]
- Updated dependencies [272e77c]
  - @fiber-pay/react@0.2.5
  - @fiber-pay/sdk@0.2.5

## 0.0.5

### Patch Changes

- Updated dependencies [b049830]
- Updated dependencies [d8f763b]
- Updated dependencies [0f6ead3]
- Updated dependencies [713aa2d]
  - @fiber-pay/sdk@0.2.4
  - @fiber-pay/react@0.2.4

## 0.0.4

### Patch Changes

- Updated dependencies [000909c]
  - @fiber-pay/react@0.2.3
  - @fiber-pay/sdk@0.2.3

## 0.0.3

### Patch Changes

- 1e96626: fix: improve PRF detection for Chrome on Linux

  - Remove fallback detection that triggered unwanted passkey UI
  - When getClientCapabilities() returns prf: undefined (Chrome on Linux),
    return 'unknown' status instead of attempting detection
  - Update UI to show passkey option when capability is 'unknown',
    allowing users to try passkey on platforms with incomplete capability reporting

- Updated dependencies [76bbe85]
- Updated dependencies [1e96626]
  - @fiber-pay/sdk@0.2.2

## 0.0.2

### Patch Changes

- Updated dependencies [dec5314]
- Updated dependencies [3876ef5]
  - @fiber-pay/sdk@0.2.1

## 0.0.1

### Patch Changes

- Updated dependencies [b912f08]
- Updated dependencies [872c624]
- Updated dependencies [543461e]
  - @fiber-pay/sdk@0.2.0
