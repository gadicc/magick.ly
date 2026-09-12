"use client";

import {
  Button,
  Checkbox,
  Container,
  FormControlLabel,
  FormGroup,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import { DatePicker } from "@mui/x-date-pickers";
import type { DateValidationError, FieldRef } from "@mui/x-date-pickers/models";
import dayjs, { Dayjs } from "dayjs";
import { db, useGongoOne } from "gongo-client-react";
import { useRouter } from "next/navigation";
import React, { use } from "react";
import { useForm } from "@/lib/forms";
import {
  TempleMembershipClient,
  templeMembershipClientSchema,
} from "@/schemas";

export default function TemplesAdminEditMembershipPage(props: {
  params: Promise<{
    _id: string;
    membershipId: string;
  }>;
}) {
  const params = use(props.params);

  const { _id, membershipId } = params;

  const router = useRouter();
  const dateFieldRef = React.useRef<FieldRef<Dayjs | null>>(null);
  const pickerErrorRef = React.useRef<DateValidationError>(null);
  const [dateError, setDateError] = React.useState<string | null>(null);

  const temple = useGongoOne((db) => db.collection("temples").find({ _id }));
  const membership = useGongoOne((db) =>
    db.collection("templeMemberships").find({ _id: membershipId }),
  );
  const user = useGongoOne((db) =>
    db.collection("users").find({ _id: membership?.userId }),
  );

  //console.log({ temple, membership, user });

  const useFormProps = useForm<TempleMembershipClient>({
    values: membership || undefined,
    schema: templeMembershipClientSchema,
    defaultValues: {},
  });
  const {
    handleSubmit,
    // setValue,
    // getValues,
    control,
    Controller,
    fr,
    formState: { isDirty },
  } = useFormProps;

  function onSubmit(
    membership: TempleMembershipClient,
    _event?: React.BaseSyntheticEvent,
  ) {
    // MUI 9 publishes null while a section is empty, even if other sections
    // still contain a date. Only a completely empty field means a real clear.
    const sections = dateFieldRef.current?.getSections() ?? [];
    const filled = sections.filter((section) => section.value !== "").length;
    if (filled > 0 && filled < sections.length) {
      setDateError("Enter a complete date or clear the field.");
      dateFieldRef.current?.focusField();
      return;
    }
    if (pickerErrorRef.current) {
      setDateError("Enter a valid date.");
      dateFieldRef.current?.focusField();
      return;
    }

    const {
      _id,
      userId: _userId,
      templeId: _templeId,
      addedAt: _addedAt,
      ...$set
    } = membership;

    if (dayjs.isDayjs($set.memberSince))
      $set.memberSince = $set.memberSince.toDate();

    // console.log("$set", $set);
    // return;

    db.collection("templeMemberships").update(membershipId, { $set });

    const event = _event as
      | React.SyntheticEvent<HTMLFormElement, SubmitEvent>
      | undefined;
    const submitter = event?.nativeEvent.submitter;
    const dest = submitter?.getAttribute("data-dest");
    if (dest === "back") router.back();
  }

  return (
    <Container sx={{ my: 2 }}>
      <Typography variant="h5">Edit Membership</Typography>
      {user?.displayName} in {temple?.name} Temple
      <br />
      <br />
      <form onSubmit={handleSubmit(onSubmit)}>
        <TextField
          {...fr("motto")}
          label="Motto"
          fullWidth
          sx={{ marginBottom: 2 }}
          slotProps={{ inputLabel: { shrink: true } }}
        />
        <Stack direction="row" spacing={2} sx={{ marginBottom: 2 }}>
          <TextField
            {...fr("grade")}
            type="number"
            label="Grade"
            slotProps={{ inputLabel: { shrink: true } }}
          />
          <Controller
            name="admin"
            control={control}
            render={({ field }) => (
              <FormGroup>
                <FormControlLabel
                  control={
                    <Checkbox
                      checked={field.value || false}
                      onChange={field.onChange}
                      onBlur={field.onBlur}
                    />
                  }
                  label="Admin"
                />
              </FormGroup>
            )}
          />
        </Stack>
        <Controller
          control={control}
          name="memberSince"
          render={({ field, fieldState }) => (
            <DatePicker
              label="Member since"
              value={field.value ? dayjs(field.value) : null}
              onChange={(value, context) => {
                pickerErrorRef.current = context.validationError;
                setDateError(
                  context.validationError ? "Enter a valid date." : null,
                );
                field.onChange(value);
              }}
              onError={(error) => {
                pickerErrorRef.current = error;
                setDateError(error ? "Enter a valid date." : null);
              }}
              sx={{ marginBottom: 2 }}
              slotProps={{
                field: {
                  clearable: true,
                  fieldRef: dateFieldRef,
                  onClear: () => {
                    pickerErrorRef.current = null;
                    setDateError(null);
                  },
                },
                textField: {
                  error: !!dateError || !!fieldState.error,
                  helperText: dateError || fieldState.error?.message,
                },
              }}
            />
          )}
        />
        <Stack spacing={1} direction="row">
          <Button
            variant="outlined"
            type="submit"
            fullWidth
            disabled={!isDirty}
          >
            Save
          </Button>
          <Button
            variant="contained"
            type="submit"
            fullWidth
            data-dest="back"
            disabled={!isDirty}
          >
            Save & Back
          </Button>
        </Stack>
      </form>
    </Container>
  );
}
