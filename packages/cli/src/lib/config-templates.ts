export type FiberNetwork = 'testnet' | 'mainnet';

export const TESTNET_CONFIG_TEMPLATE_V071 = `# This configuration file only contains the necessary configurations for the testnet deployment.
# All options' descriptions can be found via \`fnn --help\` and be overridden by command line arguments or environment variables.
fiber:
  listening_addr: "/ip4/0.0.0.0/tcp/8228"
  bootnode_addrs:
    - "/ip4/54.179.226.154/tcp/8228/p2p/Qmes1EBD4yNo9Ywkfe6eRw9tG1nVNGLDmMud1xJMsoYFKy"
    - "/ip4/16.163.7.105/tcp/8228/p2p/QmdyQWjPtbK4NWWsvy8s69NGJaQULwgeQDT5ZpNDrTNaeV"
  announce_listening_addr: true
  announced_addrs:
    # If you want to announce your fiber node public address to the network, you need to add the address here, please change the ip to your public ip accordingly.
    # - "/ip4/YOUR-FIBER-NODE-PUBLIC-IP/tcp/8228"
  chain: testnet
  # lock script configurations related to fiber network
  # https://github.com/nervosnetwork/fiber-scripts/blob/main/deployment/testnet/migrations/2025-02-28-111246.json
  scripts:
    - name: FundingLock
      script:
        code_hash: "0x6c67887fe201ee0c7853f1682c0b77c0e6214044c156c7558269390a8afa6d7c"
        hash_type: type
        args: "0x"
      cell_deps:
        - type_id:
            code_hash: "0x00000000000000000000000000000000000000000000000000545950455f4944"
            hash_type: type
            args: "0x3cb7c0304fe53f75bb5727e2484d0beae4bd99d979813c6fc97c3cca569f10f6"
        - cell_dep:
            out_point:
              tx_hash: "0x12c569a258dd9c5bd99f632bb8314b1263b90921ba31496467580d6b79dd14a7" # ckb_auth
              index: 0x0
            dep_type: code
    - name: CommitmentLock
      script:
        code_hash: "0x740dee83f87c6f309824d8fd3fbdd3c8380ee6fc9acc90b1a748438afcdf81d8"
        hash_type: type
        args: "0x"
      cell_deps:
        - type_id:
            code_hash: "0x00000000000000000000000000000000000000000000000000545950455f4944"
            hash_type: type
            args: "0xf7e458887495cf70dd30d1543cad47dc1dfe9d874177bf19291e4db478d5751b"
        - cell_dep:
            out_point:
              tx_hash: "0x12c569a258dd9c5bd99f632bb8314b1263b90921ba31496467580d6b79dd14a7" #ckb_auth
              index: 0x0
            dep_type: code

rpc:
  # By default RPC only binds to localhost, thus it only allows accessing from the same machine.
  # Allowing arbitrary machines to access the JSON-RPC port is dangerous and strongly discouraged.
  # Please strictly limit the access to only trusted machines.
  listening_addr: "127.0.0.1:8227"

ckb:
  rpc_url: "https://testnet.ckbapp.dev/"
  udt_whitelist:
    - name: RUSD
      script:
        code_hash: "0x1142755a044bf2ee358cba9f2da187ce928c91cd4dc8692ded0337efa677d21a"
        hash_type: type
        args: "0x878fcc6f1f08d48e87bb1c3b3d5083f23f8a39c5d5c764f253b55b998526439b"
      cell_deps:
        - type_id:
            code_hash: "0x00000000000000000000000000000000000000000000000000545950455f4944"
            hash_type: type
            args: "0x97d30b723c0b2c66e9cb8d4d0df4ab5d7222cbb00d4a9a2055ce2e5d7f0d8b0f"
      auto_accept_amount: 1000000000

services:
  - fiber
  - rpc
  - ckb
`;

export const MAINNET_CONFIG_TEMPLATE_V071 = `# This configuration file only contains the necessary configurations for the mainnet deployment.
# All options' descriptions can be found via \`fnn --help\` and be overridden by command line arguments or environment variables.
fiber:
  listening_addr: "/ip4/0.0.0.0/tcp/8228"
  bootnode_addrs:
    - "/ip4/43.199.24.44/tcp/8228/p2p/QmZ2gCTfEF6vKsiYFF2STPeA2rRLRim9nMtzfwiE7uMQ4v"
    - "/ip4/54.255.71.126/tcp/8228/p2p/QmcMLnWraRyxd7PFRgvn1QeYRQS2DGsP6fPFCQjtfMs5b2"
  announce_listening_addr: true
  announced_addrs:
    # If you want to announce your fiber node public address to the network, you need to add the address here.
    # Please change the ip to your public ip accordingly, and make sure the port is open and reachable from the internet.
    # - "/ip4/YOUR-FIBER-NODE-PUBLIC-IP/tcp/8228"
  chain: mainnet
  # lock script configurations related to fiber network
  # https://github.com/nervosnetwork/fiber-scripts/blob/main/deployment/mainnet/migrations/2025-02-28-114908.json
  scripts:
    - name: FundingLock
      script:
        code_hash: "0xe45b1f8f21bff23137035a3ab751d75b36a981deec3e7820194b9c042967f4f1"
        hash_type: type
        args: "0x"
      cell_deps:
        - type_id:
            code_hash: "0x00000000000000000000000000000000000000000000000000545950455f4944"
            hash_type: type
            args: "0x64818d82a372312fb007c480391e1b9759d21b2c7f7959b9c177d72cdc243394"
        - cell_dep:
            out_point:
              tx_hash: "0x95006eee7b4c0c8ad66e0514c88ed0ae43fc8db27793427de86a348ec720b9d6" # ckb_auth
              index: 0x0
            dep_type: code
    - name: CommitmentLock
      script:
        code_hash: "0x2d45c4d3ed3e942f1945386ee82a5d1b7e4bb16d7fe1ab015421174ab747406c"
        hash_type: type
        args: "0x"
      cell_deps:
        - type_id:
            code_hash: "0x00000000000000000000000000000000000000000000000000545950455f4944"
            hash_type: type
            args: "0xdb16e6dcb17f670e5fb7c556d81e522ec5edb069ad2fa3e898e7ccea6c26a39f"
        - cell_dep:
            out_point:
              tx_hash: "0x95006eee7b4c0c8ad66e0514c88ed0ae43fc8db27793427de86a348ec720b9d6" #ckb_auth
              index: 0x0
            dep_type: code

rpc:
  # By default RPC only binds to localhost, thus it only allows accessing from the same machine.
  # Allowing arbitrary machines to access the JSON-RPC port is dangerous and strongly discouraged.
  # Please strictly limit the access to only trusted machines.
  listening_addr: "127.0.0.1:8227"

ckb:
  # Please use a trusted CKB RPC node, the node should be able to provide the correct data and should be stable.
  rpc_url: "http://127.0.0.1:8114/"
  udt_whitelist:
    ## https://github.com/CKBFansDAO/xudtlogos/blob/f2557839ecde0409ba674516a62ae6752bc0daa9/public/tokens/token_list.json#L548
    - name: USDI
      script:
        code_hash: "0xbfa35a9c38a676682b65ade8f02be164d48632281477e36f8dc2f41f79e56bfc"
        hash_type: type
        args: "0xd591ebdc69626647e056e13345fd830c8b876bb06aa07ba610479eb77153ea9f"
      cell_deps:
        - type_id:
            code_hash: "0x00000000000000000000000000000000000000000000000000545950455f4944"
            hash_type: type
            args: "0x9105ea69838511ca609518d27855c53fed1b5ffaff4cfb334f58b40627d211c4"
      auto_accept_amount: 10000000

services:
  - fiber
  - rpc
  - ckb
`;

export function getConfigTemplate(network: FiberNetwork): string {
  return network === 'mainnet' ? MAINNET_CONFIG_TEMPLATE_V071 : TESTNET_CONFIG_TEMPLATE_V071;
}
