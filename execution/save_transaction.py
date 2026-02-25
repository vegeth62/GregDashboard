#!/usr/bin/env python3
import sys
import csv
import os
import argparse
from datetime import datetime

def setup_argparse():
    parser = argparse.ArgumentParser(description='Save a financial transaction to CSV.')
    parser.add_argument('--date', required=True, help='Date in YYYY-MM-DD format')
    parser.add_argument('--amount', required=True, type=float, help='Transaction amount')
    parser.add_argument('--description', required=True, help='Description of the transaction')
    parser.add_argument('--category', required=True, help='Category of the transaction')
    parser.add_argument('--type', required=True, choices=['Income', 'Expense'], help='Type of transaction')
    return parser

def main():
    parser = setup_argparse()
    try:
        args = parser.parse_args()
    except SystemExit:
        # If arguments are missing, read from stdin as a fallback or for batch processing if needed later
        # For now, just exit with error
        sys.exit(1)

    # Validate Date
    try:
        datetime.strptime(args.date, '%Y-%m-%d')
    except ValueError:
        print("Error: Date must be in YYYY-MM-DD format", file=sys.stderr)
        sys.exit(1)

    # Define File Path
    # Using .tmp directory relative to the script location or project root
    # Assuming script is in /execution/ and we want /.tmp/
    script_dir = os.path.dirname(os.path.abspath(__file__))
    project_root = os.path.dirname(script_dir)
    tmp_dir = os.path.join(project_root, '.tmp')
    
    if not os.path.exists(tmp_dir):
        os.makedirs(tmp_dir)
        
    csv_file = os.path.join(tmp_dir, 'transactions.csv')
    
    file_exists = os.path.isfile(csv_file)
    
    try:
        with open(csv_file, mode='a', newline='', encoding='utf-8') as f:
            writer = csv.DictWriter(f, fieldnames=['date', 'amount', 'description', 'category', 'type'])
            
            if not file_exists:
                writer.writeheader()
                
            writer.writerow({
                'date': args.date,
                'amount': args.amount,
                'description': args.description,
                'category': args.category,
                'type': args.type
            })
            
        print(f"Transaction saved successfully to {csv_file}")
        
    except Exception as e:
        print(f"Error saving transaction: {e}", file=sys.stderr)
        sys.exit(1)

if __name__ == "__main__":
    main()
