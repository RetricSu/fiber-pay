import type { NewInvoiceParams, UdtAsset } from '@fiber-pay/sdk/browser';
import { parsePaymentAmount, validateUdtTypeScript } from '@fiber-pay/sdk/browser';

export interface BuildNewInvoiceParamsOptions {
  amountInput: string;
  asset: UdtAsset;
  network: 'mainnet' | 'testnet';
  descriptionPrefix: string;
}

export function buildNewInvoiceParams(options: BuildNewInvoiceParamsOptions): NewInvoiceParams {
  const { amountInput, asset, network, descriptionPrefix } = options;

  const safeAmount = amountInput.replace(/[^\d.]/g, '').slice(0, 32);
  const safeName = (asset.kind === 'udt' ? asset.name?.trim() : 'CKB')?.slice(0, 32) ?? 'UDT';

  const parsedAmount = parsePaymentAmount(amountInput.trim(), asset);
  const params: NewInvoiceParams = {
    amount: `0x${parsedAmount.toString(16)}`,
    currency: network === 'mainnet' ? 'Fibb' : 'Fibt',
    description: `${descriptionPrefix} (${safeAmount} ${safeName})`,
  };

  if (asset.kind === 'udt') {
    params.udt_type_script = validateUdtTypeScript(asset.script);
  }

  return params;
}
