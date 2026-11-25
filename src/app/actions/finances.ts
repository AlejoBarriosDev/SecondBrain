"use server";

import { revalidatePath } from "next/cache";
import { requireSession } from "@/lib/auth/session";
import {
  archiveAccount,
  createAccount,
  type CreateAccountInput,
  updateAccount,
  type UpdateAccountInput,
} from "@/modules/finances/accounts";
import {
  createCategory,
  type CreateCategoryInput,
  deleteCategory,
  updateCategory,
  type UpdateCategoryInput,
} from "@/modules/finances/categories";
import {
  deleteBudget,
  upsertBudget,
  type UpsertBudgetInput,
} from "@/modules/finances/budgets";
import {
  createTransaction,
  type CreateTransactionInput,
  deleteTransaction,
  updateTransaction,
  type UpdateTransactionInput,
  voidTransaction,
} from "@/modules/finances/transactions";
import {
  createTransfer,
  type CreateTransferInput,
  deleteTransfer,
} from "@/modules/finances/transfers";
import {
  createRecurringRule,
  type CreateRecurringRuleInput,
  deleteRecurringRule,
  runDueRecurringRules,
  updateRecurringRule,
  type UpdateRecurringRuleInput,
} from "@/modules/finances/recurring";

function revalidateFinancePaths() {
  revalidatePath("/");
  revalidatePath("/accounts");
  revalidatePath("/transactions");
  revalidatePath("/transfers");
  revalidatePath("/budgets");
  revalidatePath("/categories");
  revalidatePath("/recurring");
}

export async function createAccountAction(input: CreateAccountInput) {
  const { user } = await requireSession();
  const result = await createAccount(user.id, input);
  revalidateFinancePaths();
  return result;
}

export async function updateAccountAction(
  id: string,
  input: UpdateAccountInput,
) {
  const { user } = await requireSession();
  const result = await updateAccount(user.id, id, input);
  revalidateFinancePaths();
  return result;
}

export async function archiveAccountAction(id: string) {
  const { user } = await requireSession();
  const result = await archiveAccount(user.id, id);
  revalidateFinancePaths();
  return result;
}

export async function createCategoryAction(input: CreateCategoryInput) {
  const { user } = await requireSession();
  const result = await createCategory(user.id, input);
  revalidateFinancePaths();
  return result;
}

export async function updateCategoryAction(
  id: string,
  input: UpdateCategoryInput,
) {
  const { user } = await requireSession();
  const result = await updateCategory(user.id, id, input);
  revalidateFinancePaths();
  return result;
}

export async function deleteCategoryAction(id: string) {
  const { user } = await requireSession();
  const result = await deleteCategory(user.id, id);
  revalidateFinancePaths();
  return result;
}

export async function upsertBudgetAction(input: UpsertBudgetInput) {
  const { user } = await requireSession();
  const result = await upsertBudget(user.id, input);
  revalidateFinancePaths();
  return result;
}

export async function deleteBudgetAction(id: string) {
  const { user } = await requireSession();
  const result = await deleteBudget(user.id, id);
  revalidateFinancePaths();
  return result;
}

export async function createTransactionAction(input: CreateTransactionInput) {
  const { user } = await requireSession();
  const result = await createTransaction(user.id, input);
  revalidateFinancePaths();
  return result;
}

export async function updateTransactionAction(
  id: string,
  input: UpdateTransactionInput,
) {
  const { user } = await requireSession();
  const result = await updateTransaction(user.id, id, input);
  revalidateFinancePaths();
  return result;
}

export async function voidTransactionAction(id: string) {
  const { user } = await requireSession();
  const result = await voidTransaction(user.id, id);
  revalidateFinancePaths();
  return result;
}

export async function deleteTransactionAction(id: string) {
  const { user } = await requireSession();
  const result = await deleteTransaction(user.id, id);
  revalidateFinancePaths();
  return result;
}

export async function createTransferAction(input: CreateTransferInput) {
  const { user } = await requireSession();
  const result = await createTransfer(user.id, input);
  revalidateFinancePaths();
  return result;
}

export async function deleteTransferAction(transferGroupId: string) {
  const { user } = await requireSession();
  const result = await deleteTransfer(user.id, transferGroupId);
  revalidateFinancePaths();
  return result;
}

export async function createRecurringRuleAction(
  input: CreateRecurringRuleInput,
) {
  const { user } = await requireSession();
  const result = await createRecurringRule(user.id, input);
  revalidateFinancePaths();
  return result;
}

export async function updateRecurringRuleAction(
  id: string,
  input: UpdateRecurringRuleInput,
) {
  const { user } = await requireSession();
  const result = await updateRecurringRule(user.id, id, input);
  revalidateFinancePaths();
  return result;
}

export async function deleteRecurringRuleAction(id: string) {
  const { user } = await requireSession();
  const result = await deleteRecurringRule(user.id, id);
  revalidateFinancePaths();
  return result;
}

export async function runDueRecurringRulesAction() {
  const { user } = await requireSession();
  const result = await runDueRecurringRules({ userId: user.id });
  revalidateFinancePaths();
  return result;
}
