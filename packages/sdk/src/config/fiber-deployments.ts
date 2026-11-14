export type FiberNetwork = 'testnet' | 'mainnet';

/**
 * Network-specific Fiber contract deployments mirrored from fnn v0.10.1
 * config/{network}/config.yml. Shared by browser, native node, and CLI configs.
 */
export const FIBER_SCRIPTS_BY_NETWORK = {
  testnet: [
    {
      name: 'FundingLock',
      script: {
        code_hash: '0x6c67887fe201ee0c7853f1682c0b77c0e6214044c156c7558269390a8afa6d7c',
        hash_type: 'type',
        args: '0x',
      },
      cell_deps: [
        {
          type_id: {
            code_hash: '0x00000000000000000000000000000000000000000000000000545950455f4944',
            hash_type: 'type',
            args: '0x3cb7c0304fe53f75bb5727e2484d0beae4bd99d979813c6fc97c3cca569f10f6',
          },
        },
        {
          cell_dep: {
            out_point: {
              tx_hash: '0x12c569a258dd9c5bd99f632bb8314b1263b90921ba31496467580d6b79dd14a7',
              index: '0x0',
            },
            dep_type: 'code',
          },
        },
      ],
    },
    {
      name: 'CommitmentLock',
      script: {
        code_hash: '0x740dee83f87c6f309824d8fd3fbdd3c8380ee6fc9acc90b1a748438afcdf81d8',
        hash_type: 'type',
        args: '0x',
      },
      cell_deps: [
        {
          type_id: {
            code_hash: '0x00000000000000000000000000000000000000000000000000545950455f4944',
            hash_type: 'type',
            args: '0xf7e458887495cf70dd30d1543cad47dc1dfe9d874177bf19291e4db478d5751b',
          },
        },
        {
          cell_dep: {
            out_point: {
              tx_hash: '0x12c569a258dd9c5bd99f632bb8314b1263b90921ba31496467580d6b79dd14a7',
              index: '0x0',
            },
            dep_type: 'code',
          },
        },
      ],
    },
  ],
  mainnet: [
    {
      name: 'FundingLock',
      script: {
        code_hash: '0xe45b1f8f21bff23137035a3ab751d75b36a981deec3e7820194b9c042967f4f1',
        hash_type: 'type',
        args: '0x',
      },
      cell_deps: [
        {
          type_id: {
            code_hash: '0x00000000000000000000000000000000000000000000000000545950455f4944',
            hash_type: 'type',
            args: '0x64818d82a372312fb007c480391e1b9759d21b2c7f7959b9c177d72cdc243394',
          },
        },
        {
          cell_dep: {
            out_point: {
              tx_hash: '0x95006eee7b4c0c8ad66e0514c88ed0ae43fc8db27793427de86a348ec720b9d6',
              index: '0x0',
            },
            dep_type: 'code',
          },
        },
      ],
    },
    {
      name: 'CommitmentLock',
      script: {
        code_hash: '0x2d45c4d3ed3e942f1945386ee82a5d1b7e4bb16d7fe1ab015421174ab747406c',
        hash_type: 'type',
        args: '0x',
      },
      cell_deps: [
        {
          type_id: {
            code_hash: '0x00000000000000000000000000000000000000000000000000545950455f4944',
            hash_type: 'type',
            args: '0xdb16e6dcb17f670e5fb7c556d81e522ec5edb069ad2fa3e898e7ccea6c26a39f',
          },
        },
        {
          cell_dep: {
            out_point: {
              tx_hash: '0x95006eee7b4c0c8ad66e0514c88ed0ae43fc8db27793427de86a348ec720b9d6',
              index: '0x0',
            },
            dep_type: 'code',
          },
        },
      ],
    },
  ],
} as const;
