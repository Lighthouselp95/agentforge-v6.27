# Chương 6: Form & Validation - Từ Cơ Bản đến Sạch Sẽ

### 6.1 Vấn đề với React Native Form

Form trong React dễ bị:
- Re-render thừa mỗi khi gõ
- Validation logic lộn xộn
- Không handle async submit
- Khó reset, khó disabled button khi submit

### 6.2 React Hook Form - Tiêu Chuẩn 2024

```tsx
import { useForm, SubmitHandler } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';

// 1. Schema validation với Zod
const loginSchema = z.object({
  email: z.string().email('Invalid email'),
  password: z.string().min(8, 'Password >= 8 chars').max(64),
});
type LoginForm = z.infer<typeof loginSchema>;

// 2. useForm với Zod resolver
const {
  register,
  handleSubmit,
  formState: { errors, isSubmitting, isValid },
  reset,
  setError,
} = useForm<LoginForm>({
  resolver: zodResolver(loginSchema),
  mode: 'onBlur',  // validate khi blur
  defaultValues: { email: '', password: '' },
});

// 3. Submit handler với type safety
const onSubmit: SubmitHandler<LoginForm> = async (data) => {
  try {
    await api.login(data);
    reset();  // reset form
  } catch (err) {
    setError('root.server', { message: 'Login failed' });  // error global
  }
};

// 4. JSX
return (
  <form onSubmit={handleSubmit(onSubmit)}>
    <input {...register('email')} />
    {errors.email && <span>{errors.email.message}</span>}

    <input type="password" {...register('password')} />
    {errors.password && <span>{errors.password.message}</span>}

    <button type="submit" disabled={isSubmitting || !isValid}>
      {isSubmitting ? 'Loading...' : 'Login'}
    </button>
  </form>
);
```

### 6.3 Nested Object & Array Fields

```tsx
// Schema cho form nested
const schema = z.object({
  user: z.object({
    name: z.string(),
    addresses: z.array(z.object({
      street: z.string(),
      city: z.string(),
    })),
  }),
});

// register với dot notation
<input {...register('user.name')} />
<input {...register('user.addresses.0.street')} />

// Dynamic array field
function AddressList() {
  const { fields, append, remove } = useFieldArray({ name: 'user.addresses' });
  return fields.map((field, index) => (
    <div key={field.id}>
      <input {...register(`user.addresses.${index}.street`)} />
      <button type="button" onClick={() => remove(index)}>Remove</button>
    </div>
  ));
}
```

### 6.4 Custom Validation

```tsx
// Validation riêng cho field
const schema = z.object({
  password: z.string().min(8),
  confirmPassword: z.string(),
}).refine(data => data.password === data.confirmPassword, {
  message: "Passwords don't match",
  path: ['confirmPassword'],
});

// Async validation
const usernameSchema = z.string().refine(async (val) => {
  const res = await fetch(`/api/check-username?name=${val}`);
  return res.ok;
}, 'Username taken');
```

### 6.5 File Upload với React Hook Form

```tsx
const uploadSchema = z.object({
  file: z.instanceof(File).refine(f => f.size <= 5 * 1024 * 1024, 'Max 5MB'),
});

const { register, handleSubmit } = useForm<UploadForm>({ resolver: zodResolver(uploadSchema) });

return (
  <form onSubmit={handleSubmit(onSubmit)}>
    <input type="file" {...register('file')} accept="image/*" />
    <button type="submit">Upload</button>
  </form>
);
```

### 6.6 Form Phức Tạp: Đa Bước, Điều Kiện

```tsx
// Multi-step form với useForm + step state
function MultiStepForm() {
  const [step, setStep] = useState(1);
  const { register, handleSubmit, watch } = useForm();

  const values = watch();  // để validate step tiếp theo

  return (
    <form onSubmit={handleSubmit(data => console.log(data))}>
      {step === 1 && <input {...register('email')} />}
      {step === 2 && <input {...register('password')} />}
      {step === 3 && values.email && <ConfirmEmail email={values.email} />}
      <button type="button" onClick={() => setStep(s => s + 1)}>Next</button>
    </form>
  );
}
```

### 6.7 Bài tập
Tạo form đăng ký 3 bước: Email -> Profile (avatar + bio) -> Confirm, mỗi bước validate riêng.

> Sang Chương 7 để học Data Fetching & Cache.
