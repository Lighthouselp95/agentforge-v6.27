# Chương 6: Form & Validation - React Hook Form + Zod

> "Form trong React dễ code, khó đúng. React Hook Form + Zod = giải pháp chuẩn 2024."

## 6.1 Vấn Đề Với React Native Form

- Re-render thừa mỗi khi gõ
- Validation logic lộn xộn
- Không handle async submit
- Khó reset, khó disable button khi submit

## 6.2 React Hook Form - Tiêu Chuẩn 2024

### Setup

```tsx
import { useForm, SubmitHandler } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";

// 1. Schema validation với Zod
const loginSchema = z.object({
  email: z.string().email("Invalid email").min(1, "Email is required"),
  password: z.string().min(8, "Password must be at least 8 characters").max(64),
  rememberMe: z.boolean().default(false),
});

type LoginForm = z.infer<typeof loginSchema>;

// 2. Form Component
function LoginForm() {
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting, isValid },
    reset,
    setError,
    watch,
  } = useForm<LoginForm>({
    resolver: zodResolver(loginSchema),
    mode: "onBlur",
    defaultValues: { email: "", password: "", rememberMe: false },
  });

  // 3. Submit handler
  const onSubmit: SubmitHandler<LoginForm> = async (data) => {
    try {
      await api.login(data);
      reset();
    } catch (err) {
      setError("root.server", { message: "Login failed. Please try again." });
    }
  };

  return (
    <form onSubmit={handleSubmit(onSubmit)} noValidate>
      <div>
        <label htmlFor="email">Email</label>
        <input id="email" type="email" {...register("email")} />
        {errors.email && <span>{errors.email.message}</span>}
      </div>
      <div>
        <label htmlFor="password">Password</label>
        <input id="password" type="password" {...register("password")} />
        {errors.password && <span>{errors.password.message}</span>}
      </div>
      <div>
        <input type="checkbox" {...register("rememberMe")} />
        <label>Remember me</label>
      </div>
      {errors.root?.server && <div className="error">{errors.root.server.message}</div>}
      <button type="submit" disabled={isSubmitting || !isValid}>
        {isSubmitting ? "Logging in..." : "Login"}
      </button>
    </form>
  );
}
```

## 6.3 Nested Object & Array Fields

```tsx
const schema = z.object({
  user: z.object({
    name: z.string().min(1),
    addresses: z.array(z.object({
      street: z.string().min(1),
      city: z.string().min(1),
      zip: z.string().regex(/^\d{5}$/),
    })),
  }),
});

function AddressForm() {
  const { register, control, handleSubmit } = useForm({
    resolver: zodResolver(schema),
  });
  const { fields, append, remove } = useFieldArray({ control, name: "user.addresses" });

  return (
    <form onSubmit={handleSubmit(onSubmit)}>
      <input {...register("user.name")} />
      {fields.map((field, index) => (
        <div key={field.id}>
          <input {...register(`user.addresses.${index}.street`)} />
          <input {...register(`user.addresses.${index}.city`)} />
          <input {...register(`user.addresses.${index}.zip`)} />
          <button type="button" onClick={() => remove(index)}>Remove</button>
        </div>
      ))}
      <button type="button" onClick={() => append({ street: "", city: "", zip: "" })}>Add Address</button>
    </form>
  );
}
```

## 6.4 File Upload

```tsx
const uploadSchema = z.object({
  file: z.instanceof(File).refine(f => f.size <= 5 * 1024 * 1024, "Max 5MB"),
  description: z.string().optional(),
});

function UploadForm() {
  const { register, handleSubmit } = useForm({ resolver: zodResolver(uploadSchema) });
  return (
    <form onSubmit={handleSubmit(onSubmit)}>
      <input type="file" {...register("file")} accept="image/*" />
      <input {...register("description")} placeholder="Description" />
      <button type="submit">Upload</button>
    </form>
  );
}
```

## 6.5 Multi-Step Form

```tsx
function MultiStepForm() {
  const [step, setStep] = useState(1);
  const methods = useForm({ resolver: zodResolver(currentSchema) });

  return (
    <FormProvider {...methods}>
      <form onSubmit={methods.handleSubmit(onSubmit)}>
        {step === 1 && <Step1 />}
        {step === 2 && <Step2 />}
        {step === 3 && <Step3 />}
        <button type="button" onClick={() => setStep(s => s - 1)} disabled={step === 1}>Back</button>
        {step < 3 ? (
          <button type="button" onClick={() => setStep(s => s + 1)}>Next</button>
        ) : (
          <button type="submit">Submit</button>
        )}
      </form>
    </FormProvider>
  );
}
```

## 6.6 Bài tập

### Bài 1: Registration Form
Tạo form đăng ký 3 bước với validation mỗi bước.

### Bài 2: Dynamic Form Builder
Tạo component `<FormBuilder fields={FieldConfig[]}>` render form từ config.

### Bài 3: Form với async validation
Tạo input username check trùng async khi blur.

> Sang Chương 7 để học Data Fetching & Cache.
