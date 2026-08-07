-- Add updated_at column to students table if it doesn't exist
ALTER TABLE students ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();

-- Create the trigger function that automatically sets updated_at on row modification
CREATE OR REPLACE FUNCTION update_modified_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Attach the trigger to the students table
DROP TRIGGER IF EXISTS update_students_modtime ON students;
CREATE TRIGGER update_students_modtime
    BEFORE UPDATE ON students
    FOR EACH ROW
    EXECUTE FUNCTION update_modified_column();
