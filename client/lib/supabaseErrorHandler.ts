import { PostgrestError } from "@supabase/supabase-js";

export interface SafeQueryResult<T> {
  data: T[] | T | null;
  error: PostgrestError | null;
  isTableMissing: boolean;
}

/**
 * Safe wrapper for Supabase queries that handles common errors
 */
export async function safeSupabaseQuery<T>(
  query: Promise<{ data: T | T[] | null; error: PostgrestError | null }>
): Promise<SafeQueryResult<T>> {
  try {
    const { data, error } = await query;

    // Check if table doesn't exist
    const isTableMissing =
      error?.code === "42P01" || // relation does not exist
      error?.message?.includes("does not exist");

    return {
      data,
      error,
      isTableMissing,
    };
  } catch (err) {
    console.error("Supabase query error:", err);
    return {
      data: null,
      error: err as PostgrestError,
      isTableMissing: false,
    };
  }
}

/**
 * Retry logic for failed Supabase queries
 */
export async function retrySupabaseQuery<T>(
  queryFn: () => Promise<{ data: T | T[] | null; error: PostgrestError | null }>,
  maxRetries = 3
): Promise<SafeQueryResult<T>> {
  let lastError: PostgrestError | null = null;

  for (let i = 0; i < maxRetries; i++) {
    try {
      const { data, error } = await queryFn();

      if (!error) {
        return { data, error: null, isTableMissing: false };
      }

      // Don't retry if table is missing
      if (error.code === "42P01" || error.message?.includes("does not exist")) {
        return {
          data: null,
          error,
          isTableMissing: true,
        };
      }

      lastError = error;

      // Wait before retry
      if (i < maxRetries - 1) {
        await new Promise((resolve) => setTimeout(resolve, 1000 * (i + 1)));
      }
    } catch (err) {
      lastError = err as PostgrestError;
    }
  }

  return {
    data: null,
    error: lastError,
    isTableMissing: false,
  };
}

/**
 * Handle Supabase errors gracefully
 */
export function handleSupabaseError(
  error: PostgrestError | null,
  context: string = "Operation"
): { message: string; isRetryable: boolean } {
  if (!error) {
    return { message: "", isRetryable: false };
  }

  console.error(`${context} Error:`, error);

  // Table doesn't exist
  if (error.code === "42P01" || error.message?.includes("does not exist")) {
    return {
      message: "الجدول المطلوب غير موجود في قاعدة البيانات",
      isRetryable: false,
    };
  }

  // Permission denied
  if (error.code === "42501") {
    return {
      message: "ليس لديك صلاحية للوصول إلى هذه البيانات",
      isRetryable: false,
    };
  }

  // Network error or timeout
  if (
    error.message?.includes("Failed to fetch") ||
    error.message?.includes("timeout") ||
    error.message?.includes("network")
  ) {
    return {
      message: "حدث خطأ في الاتصال بقاعدة البيانات",
      isRetryable: true,
    };
  }

  // Unique constraint violation
  if (error.code === "23505") {
    return {
      message: "هذا السجل موجود بالفعل",
      isRetryable: false,
    };
  }

  // Foreign key violation
  if (error.code === "23503") {
    return {
      message: "لا يمكن حذف هذا السجل لأنه مرتبط ببيانات أخرى",
      isRetryable: false,
    };
  }

  // Default error
  return {
    message: `حدث خطأ: ${error.message || "Unknown error"}`,
    isRetryable: true,
  };
}

/**
 * Check if a table exists by attempting a simple query
 */
export async function tableExists(
  supabase: any,
  tableName: string
): Promise<boolean> {
  try {
    const { error } = await supabase
      .from(tableName)
      .select("1")
      .limit(1);

    if (error?.code === "42P01") {
      return false;
    }

    return true;
  } catch {
    return false;
  }
}
