import { catalogApprovalRequirement } from '../tools/actionCatalog.js';
import { approvalDigest, requestApproval } from './approvalBroker.js';

async function requireApprovalIfNeeded(name, args, context, rawContext, codec, config) {
  const requirement = approvalRequirement(name, args);
  if (!requirement) return null;
  return requestApproval({
    name,
    args,
    requirement,
    context,
    rawContext,
    codec,
    config
  });
}

function approvalRequirement(name, args) {
  return catalogApprovalRequirement(name, args || {});
}

export { requireApprovalIfNeeded, approvalRequirement, approvalDigest };
