# Fiber Pay CLI 密码文档完善计划

## TL;DR

> 为 Fiber Pay CLI 创建详细的密码管理文档，并在现有文档中添加引用。
> 
> **Deliverables**:
> - 新增 `skills/fiber-pay/references/password-management.md`
> - 修改 4 个现有文档添加引用链接
> - 更新 `skills/fiber-pay/SKILL.md` References 列表
> 
> **Estimated Effort**: Short
> **Parallel Execution**: YES - 2 waves
> **Critical Path**: Task 1 → Task 2

---

## Context

### Original Request
用户发现 CLI 密码处理缺乏详细文档，希望创建专门的密码管理文档并在相关位置添加引用。

### Interview Summary
**Key Discussions**:
- 文档名确认为 `password-management.md`
- Quickstart 只添加引用链接，不修改步骤
- 默认密码做一般性说明（非强烈警告）
- 直接在主分支工作即可

### Metis Review
**Identified Gaps** (addressed):
- Gap 1: SKILL.md References 列表未包含密码管理 → 添加引用
- Gap 2: install.md 可能需要引用 → 可选，暂时不处理
- Gap 3: profile.md 现有密码内容如何处理 → 保留并链接

---

## Work Objectives

### Core Objective
创建全面的 CLI 密码管理文档，建立统一的密码配置知识中心。

### Concrete Deliverables
- `skills/fiber-pay/references/password-management.md`（新文件）
- `docs/human-quickstart.md` 添加引用
- `skills/fiber-pay/references/profile.md` 添加引用
- `skills/fiber-pay/references/configuration.md` 添加引用
- `skills/fiber-pay/SKILL.md` 添加 References 条目

### Definition of Done
- [ ] 新文档包含所有规划章节
- [ ] 所有引用链接可正常跳转
- [ ] profile.md 中的密码内容与新文档协调

### Must Have
- 三种密码配置方式详解
- 优先级顺序说明
- 密钥文件位置和格式
- 加密算法简介
- 默认密码一般说明
- 生产环境最佳实践

### Must NOT Have (Guardrails)
- 不修改现有 CLI 代码
- 不删除 profile.md 的现有内容（只添加引用）
- 不添加强烈的安全警告（按用户要求一般性说明即可）

---

## Verification Strategy

### Test Decision
- **Infrastructure exists**: NO（纯文档工作，无需测试框架）
- **Automated tests**: None
- **Framework**: N/A
- **If TDD**: N/A

### QA Policy
纯文档变更，QA 通过人工验证完成：
- 验证 markdown 语法正确
- 验证所有链接可正常跳转
- 验证内容准确性（对照代码）

---

## Execution Strategy

### Parallel Execution Waves

```
Wave 1 (Start Immediately — 创建主文档):
└── Task 1: 创建 password-management.md
    ├── 整合 profile.md 现有密码内容
    ├── 添加加密算法说明（scrypt + AES-256-GCM）
    ├── 添加默认密码一般说明
    └── 添加生产环境最佳实践

Wave 2 (After Wave 1 — 并行添加引用):
├── Task 2: 更新 docs/human-quickstart.md
├── Task 3: 更新 skills/fiber-pay/references/profile.md
├── Task 4: 更新 skills/fiber-pay/references/configuration.md
└── Task 5: 更新 skills/fiber-pay/SKILL.md
```

### Dependency Matrix

- **Task 1**: — — Task 2-5
- **Task 2**: Task 1 — —
- **Task 3**: Task 1 — —
- **Task 4**: Task 1 — —
- **Task 5**: Task 1 — —

### Agent Dispatch Summary

- **Wave 1**: **1** — Task 1 → `writing`（技术文档写作）
- **Wave 2**: **4** — Task 2-5 → `quick`（简单编辑任务）

---

## TODOs

- [x] 1. 创建 password-management.md

  **What to do**:
  创建 `skills/fiber-pay/references/password-management.md`，包含以下内容：
  
  1. **概述**：说明本文档目的和适用场景
  2. **密码配置方式**：
     - CLI Flag: `--key-password <password>`
     - Profile: `fiber-pay config profile set keyPassword <value>`
     - 环境变量: `export FIBER_KEY_PASSWORD=<password>`
  3. **优先级顺序**：CLI flag → profile.json → env FIBER_KEY_PASSWORD
  4. **密钥文件存储**：
     - Fiber 节点密钥: `<data-dir>/fiber/sk`
     - CKB 密钥: `<data-dir>/ckb/key`
     - 文件权限: 0o600
  5. **加密技术**：
     - 算法: scrypt + AES-256-GCM
     - 密钥派生参数: N=2^14, r=8, p=1
  6. **默认密码**：说明系统在没有提供密码时会使用默认值 'fiber-pay-default-key'
  7. **生产环境最佳实践**：
     - 使用环境变量避免密码出现在 shell 历史
     - 定期更换密码
     - 密钥文件备份

  **Must NOT do**:
  - 不添加强烈的安全警告（按用户要求）
  - 不删除或修改其他文件

  **Recommended Agent Profile**:
  - **Category**: `writing`
  - **Skills**: []
  - Reason: 技术文档写作，需要清晰准确地表达密码管理概念

  **Parallelization**:
  - **Can Run In Parallel**: NO（必须先完成）
  - **Parallel Group**: Wave 1
  - **Blocks**: Task 2, 3, 4, 5
  - **Blocked By**: None

  **References**:
  - `skills/fiber-pay/references/profile.md:25-50` - 现有密码配置说明
  - `skills/fiber-pay/references/configuration.md:40,51` - keyPassword 提及
  - `packages/cli/src/lib/config.ts:241-249` - 密码优先级代码
  - `packages/sdk/src/security/crypto.ts` - 加密算法实现

  **Acceptance Criteria**:
  - [ ] 文件创建成功: `skills/fiber-pay/references/password-management.md`
  - [ ] 包含所有规划章节
  - [ ] Markdown 语法正确
  - [ ] 包含返回 references/ 目录的链接

  **QA Scenarios**:
  ```
  Scenario: 文档内容完整性
    Tool: Bash
    Preconditions: 文件已创建
    Steps:
      1. cat skills/fiber-pay/references/password-management.md
      2. grep -c "CLI flag" skills/fiber-pay/references/password-management.md
      3. grep -c "profile.json" skills/fiber-pay/references/password-management.md
      4. grep -c "FIBER_KEY_PASSWORD" skills/fiber-pay/references/password-management.md
      5. grep -c "scrypt" skills/fiber-pay/references/password-management.md
      6. grep -c "default" skills/fiber-pay/references/password-management.md
    Expected Result: 所有 grep 返回计数 >= 1
    Evidence: terminal output
  ```

  **Commit**: YES
  - Message: `docs: add password-management.md for CLI keystore security`
  - Files: `skills/fiber-pay/references/password-management.md`
  - Pre-commit: N/A

---

- [ ] 2. 在 human-quickstart.md 中添加密码文档引用

  **What to do**:
  在 `docs/human-quickstart.md` 的启动节点步骤后添加引用：
  
  在第 30 行（`fiber-pay runtime status --json`）后添加：
  ```markdown
  > **Note**: 如需配置密钥密码，请参考 [密码管理指南](../skills/fiber-pay/references/password-management.md)。
  ```

  **Must NOT do**:
  - 不修改启动步骤本身
  - 不添加详细的密码配置步骤

  **Recommended Agent Profile**:
  - **Category**: `quick`
  - **Skills**: []
  - Reason: 简单的引用添加，无需复杂技能

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 2
  - **Blocks**: None
  - **Blocked By**: Task 1

  **References**:
  - `docs/human-quickstart.md:24-33` - 启动节点部分

  **Acceptance Criteria**:
  - [ ] 引用添加成功
  - [ ] 链接语法正确
  - [ ] 链接可正常跳转

  **QA Scenarios**:
  ```
  Scenario: 引用添加验证
    Tool: Bash
    Preconditions: Task 1 已完成
    Steps:
      1. grep "password-management" docs/human-quickstart.md
    Expected Result: 返回包含链接的行
    Evidence: terminal output
  ```

  **Commit**: NO (groups with Task 3-5)

---

- [ ] 3. 在 profile.md 中添加密码文档引用

  **What to do**:
  在 `skills/fiber-pay/references/profile.md` 的 keyPassword 说明后添加引用：
  
  在第 33 行（`keyPassword` 描述行）后添加链接：
  ```markdown
  | `keyPassword` | Keystore encryption password — [see password-management.md](password-management.md) for details |
  ```

  在第 49 行后添加段落：
  ```markdown
  关于密码配置的详细信息，请参考 [密码管理指南](password-management.md)。
  ```

  **Must NOT do**:
  - 不删除现有的密码内容
  - 不大幅修改现有结构

  **Recommended Agent Profile**:
  - **Category**: `quick`
  - **Skills**: []
  - Reason: 简单的链接添加

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 2
  - **Blocks**: None
  - **Blocked By**: Task 1

  **References**:
  - `skills/fiber-pay/references/profile.md:27-53` - 密码相关内容

  **Acceptance Criteria**:
  - [ ] 表格中添加了链接
  - [ ] 添加了引导段落

  **QA Scenarios**:
  ```
  Scenario: 引用添加验证
    Tool: Bash
    Steps:
      1. grep "password-management.md" skills/fiber-pay/references/profile.md
    Expected Result: 返回 2 行匹配
    Evidence: terminal output
  ```

  **Commit**: NO (groups with Task 2, 4, 5)

---

- [ ] 4. 在 configuration.md 中添加密码文档引用

  **What to do**:
  在 `skills/fiber-pay/references/configuration.md` 的 profile.json scope 部分添加引用：
  
  在第 42 行后添加：
  ```markdown
  See [password-management.md](password-management.md) for detailed keystore password configuration.
  ```

  **Must NOT do**:
  - 不修改现有的简要说明

  **Recommended Agent Profile**:
  - **Category**: `quick`
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 2
  - **Blocks**: None
  - **Blocked By**: Task 1

  **References**:
  - `skills/fiber-pay/references/configuration.md:37-44` - profile.json scope

  **Acceptance Criteria**:
  - [ ] 链接添加成功

  **QA Scenarios**:
  ```
  Scenario: 引用添加验证
    Tool: Bash
    Steps:
      1. grep "password-management.md" skills/fiber-pay/references/configuration.md
    Expected Result: 返回匹配行
    Evidence: terminal output
  ```

  **Commit**: NO (groups with Task 2-3, 5)

---

- [ ] 5. 在 SKILL.md 中添加 References 条目

  **What to do**:
  在 `skills/fiber-pay/SKILL.md` 的 References 部分添加新条目：
  
  在现有 References 列表末尾（约第 74 行）添加：
  ```markdown
  - **Password Management**: Read [references/password-management.md](references/password-management.md) for keystore encryption, password configuration, and security best practices.
  ```

  **Must NOT do**:
  - 保持与其他条目一致的格式
  - 不添加过多的细节

  **Recommended Agent Profile**:
  - **Category**: `quick`
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 2
  - **Blocks**: None
  - **Blocked By**: Task 1

  **References**:
  - `skills/fiber-pay/SKILL.md:63-74` - References 部分

  **Acceptance Criteria**:
  - [ ] 条目添加成功
  - [ ] 格式与其他条目一致

  **QA Scenarios**:
  ```
  Scenario: 引用添加验证
    Tool: Bash
    Steps:
      1. grep "password-management.md" skills/fiber-pay/SKILL.md
    Expected Result: 返回匹配行
    Evidence: terminal output
  ```

  **Commit**: YES (groups with Task 2-4)
  - Message: `docs: add references to password-management.md`
  - Files: `docs/human-quickstart.md`, `skills/fiber-pay/references/profile.md`, `skills/fiber-pay/references/configuration.md`, `skills/fiber-pay/SKILL.md`

---

## Final Verification Wave

> 4 review agents run in PARALLEL. ALL must APPROVE. Rejection → fix → re-run.

- [ ] F1. **Plan Compliance Audit** — `oracle`
  检查所有文档修改是否按计划完成：
  - 新文件是否包含所有规划章节
  - 所有引用链接是否正确
  - profile.md 是否协调一致
  - Evidence: `.sisyphus/evidence/final-verification.md`

- [ ] F2. **Link Verification** — `quick`
  验证所有链接可正常跳转：
  - 检查相对路径是否正确
  - 验证 markdown 链接语法
  - Evidence: `.sisyphus/evidence/link-check.md`

- [ ] F3. **Content Quality Review** — `writing`
  检查文档质量：
  - 语法和拼写检查
  - 格式一致性
  - 清晰度评估
  - Evidence: `.sisyphus/evidence/content-review.md`

- [ ] F4. **Scope Fidelity Check** — `deep`
  检查是否有过度修改：
  - 验证 profile.md 现有内容未被删除
  - 验证 quickstart 步骤未被修改
  - 验证没有添加强烈的安全警告
  - Evidence: `.sisyphus/evidence/scope-check.md`

---

## Commit Strategy

- **1**: `docs: add password-management.md for CLI keystore security` — `skills/fiber-pay/references/password-management.md`
- **2**: `docs: add references to password-management.md` — `docs/human-quickstart.md`, `skills/fiber-pay/references/profile.md`, `skills/fiber-pay/references/configuration.md`, `skills/fiber-pay/SKILL.md`

---

## Success Criteria

### Verification Commands
```bash
# 检查新文档存在
ls skills/fiber-pay/references/password-management.md

# 检查所有引用
grep -l "password-management.md" docs/human-quickstart.md skills/fiber-pay/references/profile.md skills/fiber-pay/references/configuration.md skills/fiber-pay/SKILL.md

# 检查文档内容完整性
grep "CLI flag" skills/fiber-pay/references/password-management.md
grep "scrypt" skills/fiber-pay/references/password-management.md
grep "default" skills/fiber-pay/references/password-management.md
```

### Final Checklist
- [ ] `password-management.md` 创建成功
- [ ] 包含所有规划章节
- [ ] 4 个引用位置添加完成
- [ ] 所有链接语法正确
- [ ] 无过度修改现有内容
