import { forwardRef, type ButtonHTMLAttributes, type InputHTMLAttributes } from 'react'

export const Button = forwardRef<HTMLButtonElement, ButtonHTMLAttributes<HTMLButtonElement> & { size?: string; variant?: string }>(({ size: _size, variant: _variant, ...props }, ref) => <button {...props} ref={ref}/>)
export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>((props, ref) => <input {...props} ref={ref}/>)
