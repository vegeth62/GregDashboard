# Add Transaction Directive

## Goal
Record a single financial transaction (income or expense) into the system.

## Inputs
- **Date**: YYYY-MM-DD
- **Amount**: Float (positive value)
- **Description**: String
- **Category**: String (e.g., "Food", "Rent", "Salary")
- **Type**: "Income" or "Expense"

## Tools
- `execution/save_transaction.py`

## Process
1.  Receive inputs from the user/frontend.
2.  Validate inputs (ensure amount is a number, date is valid).
3.  Call `execution/save_transaction.py` with the validated data.
4.  Return success or error message.

## Output
- JSON response indicating success.
- Log entry in `.tmp/transactions.csv`.
