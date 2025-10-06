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
import { ZodDiscriminatedUnion, type ZodRawShape } from "zod";

interface FrProps<
  TFieldValues extends FieldValues = FieldValues,
  TFieldName extends FieldPath<TFieldValues> = FieldPath<TFieldValues>,
> {
  required: boolean;
  defaultValue?: Readonly<DeepPartial<TFieldValues>>[TFieldName];
  error: boolean;
  helperText?: string;
}

export function useForm<
  TFieldValues extends FieldValues = FieldValues,
  // biome-ignore lint/suspicious/noExplicitAny: can't remember
  TContext = any,
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

  // function fr(name: keyof Omit<TFieldValues, "__ObjectIDs">) {
  function fr<
    TFieldName extends FieldPath<TFieldValues> = FieldPath<TFieldValues>,
  >(
    name: TFieldName,
    options = {} as RegisterOptions<TFieldValues, TFieldName> & {
      onChangeTransform?: boolean;
    },
  ): UseFormRegisterReturn<TFieldName> & {
    required: boolean;
    defaultValue?: Readonly<DeepPartial<TFieldValues>>[TFieldName];
    error: boolean;
    helperText?: string;
  } {
    if (!(props && props.schema))
      throw new Error("useForm requires a { schema } prop");
    const { formState, register } = useFormProps;

    const shape = (function () {
      let shape = props.schema;

      if (shape instanceof ZodDiscriminatedUnion) {
        const discriminator = shape.discriminator;
        const discriminatorValue = useFormProps.getValues(discriminator);
        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
        shape = shape.optionsMap.get(discriminatorValue)!;
      }

      for (const key of name.split(".")) {
        if ("shape" in shape) shape = (shape.shape as ZodRawShape)[key];
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
    // console.log(name, frProps, shape, shape.isOptional());

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
