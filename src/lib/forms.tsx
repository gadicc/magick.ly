import { zodResolver } from "@hookform/resolvers/zod";
import { get } from "radash";
import {
  Controller,
  DeepPartial,
  FieldErrors,
  FieldPath,
  FieldValues,
  RegisterOptions,
  useForm as reactHookUseForm,
  UseFormProps,
  UseFormRegisterReturn,
  UseFormReturn,
} from "react-hook-form";
import {
  ZodDiscriminatedUnion,
  ZodObject,
  type ZodRawShape,
  ZodTypeAny,
  z,
} from "zod";

interface FrProps<
  TFieldValues extends FieldValues = FieldValues,
  TFieldName extends FieldPath<TFieldValues> = FieldPath<TFieldValues>,
> {
  required: boolean;
  defaultValue?: Readonly<DeepPartial<TFieldValues>>[TFieldName];
  error: boolean;
  helperText?: string;
}

// ✅ only the first generic; avoid $ZodObjectConfig
function isZodObject(x: ZodTypeAny): x is ZodObject<ZodRawShape> {
  return x instanceof ZodObject;
}
function isZodArray(x: ZodTypeAny): x is z.ZodArray<ZodTypeAny> {
  return x instanceof z.ZodArray;
}

export function useForm<
  TFieldValues extends FieldValues = FieldValues,
  TContext = unknown,
  TTransformedValues extends FieldValues | undefined = undefined,
>(
  props?: UseFormProps<TFieldValues, TContext> & {
    schema?: Parameters<typeof zodResolver>[0];
  },
): UseFormReturn<TFieldValues, TContext, TTransformedValues> & {
  fr<TFieldName extends FieldPath<TFieldValues> = FieldPath<TFieldValues>>(
    name: TFieldName,
    options?: RegisterOptions<TFieldValues, TFieldName> & {
      onChangeTransform?: boolean;
    },
  ): UseFormRegisterReturn<TFieldName> & FrProps<TFieldValues, TFieldName>;
} & { Controller: typeof Controller } {
  if (!props?.schema) throw new Error("useForm requires a { schema } prop");

  const defaults = {
    resolver: zodResolver(props.schema),
    mode: "onChange" as const,
    reValidateMode: "onChange" as const,
  };

  const useFormProps = reactHookUseForm<
    TFieldValues,
    TContext,
    TTransformedValues
  >({ ...defaults, ...props });

  function fr<
    TFieldName extends FieldPath<TFieldValues> = FieldPath<TFieldValues>,
  >(
    name: TFieldName,
    options = {} as RegisterOptions<TFieldValues, TFieldName> & {
      onChangeTransform?: boolean;
    },
  ): UseFormRegisterReturn<TFieldName> & FrProps<TFieldValues, TFieldName> {
    if (!(props && props.schema))
      throw new Error("useForm requires a { schema } prop");
    const { formState, register } = useFormProps;

    const shape = (function () {
      let shape: ZodTypeAny = props.schema as ZodTypeAny;

      if (shape instanceof ZodDiscriminatedUnion) {
        // Read internals with strict structural types
        type DUInternals = { _def: { discriminator: string } };
        const discriminator = (shape as unknown as DUInternals)._def
          .discriminator as FieldPath<TFieldValues>;

        const discriminatorValue = useFormProps.getValues(discriminator);

        // ✅ options typed as ZodObject<ZodRawShape>[]
        type DUOptions = { options: ReadonlyArray<ZodObject<ZodRawShape>> };
        const optionsArr = (shape as unknown as DUOptions).options;

        const matched = optionsArr.find((opt) => {
          const discSchema = (opt.shape as ZodRawShape)[
            discriminator as string
          ] as ZodTypeAny | undefined;
          return discSchema?.safeParse(discriminatorValue).success === true;
        });

        if (matched) shape = matched;
      }

      // Walk path: objects + a simple "arr.0" hop
      for (const key of (name as string).split(".")) {
        if (isZodObject(shape)) {
          shape = (shape.shape as ZodRawShape)[key] as ZodTypeAny;
          continue;
        }
        if (isZodArray(shape) && key === "0") {
          shape = shape.element;
          continue;
        }
        break;
      }
      return shape;
    })();

    if (!shape) throw new Error(`Form has no such field "${name}"`);

    const error = get(
      formState.errors,
      name,
    ) as FieldErrors<TFieldValues>[TFieldName];

    const frProps: FrProps<TFieldValues, TFieldName> = {
      required: !shape.isOptional(),
      defaultValue: get(formState.defaultValues, name),
      error: !!error,
    };

    if (error?.message) frProps.helperText = (error.message as string) || "";

    const regProps = register(name);
    if (options.onChangeTransform) {
      const orig = regProps.onChange;
      regProps.onChange = (newValue) => orig({ target: { value: newValue } });
    }

    return { ...regProps, ...frProps };
  }

  return { ...useFormProps, fr, Controller };
}
