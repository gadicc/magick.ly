import { valibotResolver } from "@hookform/resolvers/valibot";
import { get } from "radash";
import {
  Controller,
  DeepPartial,
  FieldErrors,
  FieldPath,
  FieldValues,
  RegisterOptions,
  Resolver,
  useForm as reactHookUseForm,
  UseFormProps,
  UseFormRegisterReturn,
  UseFormReturn,
} from "react-hook-form";

type ValibotSchema = Parameters<typeof valibotResolver>[0];
type SchemaRecord = Record<string, unknown> & {
  type?: string;
  wrapped?: SchemaRecord;
  entries?: Record<string, SchemaRecord | undefined>;
  item?: SchemaRecord;
  value?: SchemaRecord;
  options?: (SchemaRecord | undefined)[] | unknown[];
  key?: string;
  rest?: SchemaRecord;
};

type GetValues = UseFormReturn<FieldValues>["getValues"];

const OPTIONAL_TYPES = new Set([
  "optional",
  "nullish",
  "undefinedable",
  "exact_optional",
]);

const WRAPPER_TYPES = new Set([
  "optional",
  "nullish",
  "undefinedable",
  "exact_optional",
  "nullable",
]);
const OBJECT_TYPES = new Set([
  "object",
  "loose_object",
  "strict_object",
  "object_with_rest",
]);

interface FrProps<
  TFieldValues extends FieldValues = FieldValues,
  TFieldName extends FieldPath<TFieldValues> = FieldPath<TFieldValues>,
> {
  required: boolean;
  defaultValue?: Readonly<DeepPartial<TFieldValues>>[TFieldName];
  error: boolean;
  helperText?: string;
}

function isSchemaRecord(schema: unknown): schema is SchemaRecord {
  return !!schema && typeof schema === "object";
}

function isOptionalSchema(schema: SchemaRecord | undefined): boolean {
  let current: SchemaRecord | undefined = schema;
  while (current && isSchemaRecord(current)) {
    if (current.type && OPTIONAL_TYPES.has(current.type)) return true;
    if ("wrapped" in current && isSchemaRecord(current.wrapped)) {
      current = current.wrapped;
      continue;
    }
    break;
  }
  return false;
}

function unwrapSchema(
  schema: SchemaRecord | undefined,
  getValues: GetValues,
  markOptional: () => void,
  options: { skipVariant?: boolean } = {},
): SchemaRecord | undefined {
  let current = schema;

  while (current && isSchemaRecord(current)) {
    const type = current.type;

    if (type && OPTIONAL_TYPES.has(type)) {
      markOptional();
      current = current.wrapped;
      continue;
    }

    if (
      type &&
      WRAPPER_TYPES.has(type) &&
      type !== "optional" &&
      type !== "nullish" &&
      type !== "undefinedable" &&
      type !== "exact_optional"
    ) {
      current = current.wrapped;
      continue;
    }

    if (!options.skipVariant && type === "variant") {
      current = resolveVariantOption(current, getValues, markOptional);
      continue;
    }

    break;
  }

  return isSchemaRecord(current) ? current : undefined;
}

function resolveVariantOption(
  schema: SchemaRecord,
  getValues: GetValues,
  markOptional: () => void,
): SchemaRecord | undefined {
  const options = Array.isArray(schema.options)
    ? (schema.options as unknown[]).filter(
        (option): option is SchemaRecord | undefined =>
          option === undefined || isSchemaRecord(option),
      )
    : [];
  if (!options.length) return schema;

  const discriminatorKey = schema.key;
  const discriminatorValue = discriminatorKey
    ? getValues(discriminatorKey as FieldPath<FieldValues>)
    : undefined;

  const match =
    discriminatorValue !== undefined
      ? options.find((option) =>
          matchesDiscriminator(
            unwrapSchema(option, getValues, () => {}, { skipVariant: true }),
            discriminatorKey,
            discriminatorValue,
            getValues,
          ),
        )
      : undefined;

  return (
    unwrapSchema(match ?? options[0], getValues, markOptional, {
      skipVariant: true,
    }) ?? undefined
  );
}

function matchesDiscriminator(
  option: SchemaRecord | undefined,
  key: string | undefined,
  value: unknown,
  getValues: GetValues,
): boolean {
  if (!option || !key) return false;
  const entries = getSchemaEntries(option);
  if (!entries) return false;
  const discriminant = unwrapSchema(entries[key], getValues, () => {}, {
    skipVariant: true,
  });
  if (!discriminant) return false;

  if ("literal" in discriminant) {
    return discriminant.literal === value;
  }

  if (discriminant.type === "enum" && Array.isArray(discriminant.options)) {
    return (discriminant.options as unknown[]).includes(value);
  }

  return false;
}

function getSchemaEntries(schema: SchemaRecord | undefined) {
  if (!schema) return undefined;
  const type = schema.type;
  if (type && OBJECT_TYPES.has(type) && isSchemaRecord(schema.entries)) {
    return schema.entries as Record<string, SchemaRecord | undefined>;
  }
  return undefined;
}

function getChildSchema(
  schema: SchemaRecord | undefined,
  segment: string,
): SchemaRecord | undefined {
  if (!schema) return undefined;
  const type = schema.type;

  if (type && OBJECT_TYPES.has(type)) {
    const entries = schema.entries ?? {};
    if (segment in entries) return entries[segment];
    if (schema.rest) return schema.rest;
  }

  if (type === "array") {
    return schema.item;
  }

  if (type === "record") {
    return schema.value;
  }

  return undefined;
}

function resolveSchemaForField(
  schema: SchemaRecord | undefined,
  fieldName: string,
  getValues: GetValues,
): { schema?: SchemaRecord; optional: boolean } {
  const parts = fieldName.split(".");
  const optionalState = { value: false };

  const markOptional = () => {
    optionalState.value = true;
  };

  function traverse(
    current: SchemaRecord | undefined,
    index: number,
  ): SchemaRecord | undefined {
    const unwrapped = unwrapSchema(current, getValues, markOptional);
    if (!unwrapped) return undefined;

    if (index >= parts.length) return unwrapped;

    if (unwrapped.type === "union" && Array.isArray(unwrapped.options)) {
      let found: SchemaRecord | undefined;
      let missing = false;

      for (const option of unwrapped.options) {
        if (!isSchemaRecord(option)) {
          missing = true;
          continue;
        }
        const result = traverse(option, index);
        if (result) {
          if (!found) found = result;
        } else {
          missing = true;
        }
      }

      if (missing) markOptional();
      return found;
    }

    const next = getChildSchema(unwrapped, parts[index]);
    if (!next) return undefined;

    return traverse(next, index + 1);
  }

  const fieldSchema = traverse(schema, 0);

  return {
    schema: fieldSchema,
    optional: optionalState.value || isOptionalSchema(fieldSchema),
  };
}

export function useForm<
  TFieldValues extends FieldValues = FieldValues,
  // biome-ignore lint: @typescript-eslint/no-explicit-any
  TContext = any,
  TTransformedValues extends FieldValues = TFieldValues,
>(
  props?: UseFormProps<TFieldValues, TContext, TTransformedValues> & {
    schema?: ValibotSchema;
  },
): UseFormReturn<TFieldValues, TContext, TTransformedValues> & {
  fr<TFieldName extends FieldPath<TFieldValues> = FieldPath<TFieldValues>>(
    name: TFieldName,
    options?: RegisterOptions<TFieldValues, TFieldName> & {
      onChangeTransform?: boolean;
    },
  ): UseFormRegisterReturn<TFieldName> & FrProps<TFieldValues, TFieldName>;
} & { Controller: typeof Controller } {
  const { schema, ...formProps } = props ?? {};

  if (!schema) throw new Error("useForm requires a { schema } prop");

  const resolver = valibotResolver(schema) as unknown as Resolver<
    TFieldValues,
    TContext,
    TTransformedValues
  >;

  const useFormProps = reactHookUseForm<
    TFieldValues,
    TContext,
    TTransformedValues
  >({
    resolver,
    mode: "onChange",
    reValidateMode: "onChange",
    ...formProps,
  });

  function fr<
    TFieldName extends FieldPath<TFieldValues> = FieldPath<TFieldValues>,
  >(
    name: TFieldName,
    options = {} as RegisterOptions<TFieldValues, TFieldName> & {
      onChangeTransform?: boolean;
    },
  ): UseFormRegisterReturn<TFieldName> & FrProps<TFieldValues, TFieldName> {
    const { formState, register, getValues } = useFormProps;

    const traversalSchema = schema as unknown as SchemaRecord;
    const traversalGetValues = getValues as unknown as GetValues;

    const { schema: fieldSchema, optional } = resolveSchemaForField(
      traversalSchema,
      String(name),
      traversalGetValues,
    );

    if (!fieldSchema) throw new Error(`Form has no such field "${name}"`);

    const error = get(
      formState.errors,
      name,
    ) as FieldErrors<TFieldValues>[TFieldName];

    const frProps: FrProps<TFieldValues, TFieldName> = {
      required: !optional,
      defaultValue: get(formState.defaultValues, name),
      error: !!error,
    };

    if (error?.message) frProps.helperText = (error.message as string) || "";

    const regProps = register(name);
    if (options.onChangeTransform) {
      const originalOnChange = regProps.onChange;
      regProps.onChange = (newValue) =>
        originalOnChange({ target: { value: newValue } });
    }

    return { ...regProps, ...frProps };
  }

  return { ...useFormProps, fr, Controller };
}
